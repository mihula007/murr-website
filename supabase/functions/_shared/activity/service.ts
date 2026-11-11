import { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { requireRole, type Actor } from '../auth/actor.ts'
import {
  activityEventSchema,
  activityEventsSchema,
  activityHistorySchema,
  activityMemberSchema,
  activitySummarySchema,
  attendancePercent,
  compareAttendance,
  daysInGuild,
  type ActivityEventOption,
  type ActivityEventResponse,
  type ActivityEventsResponse,
  type ActivityHistoryResponse,
  type ActivityHistoryRow,
  type ActivityMemberResponse,
  type ActivitySummaryResponse,
  type MonthTopResponse,
  type RatingResponse,
} from '../contracts/activity.ts'
import type { AttendanceStatus } from '../contracts/groups.ts'
import {
  moscowToUtc,
  parseTimestamp,
  utcToMoscow,
} from '../contracts/moscow-time.ts'
import { MEMBER_LIST_LIMIT } from '../contracts/paging.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { INTERNAL_ROLES, moscowDate } from '../membership.ts'
import { activityRepository, type Period } from './repository.ts'

/** Учёт активности и Excel — офицер и администратор (01-roles, Q-25). */
const ACCOUNTANTS = ['officer', 'admin'] as const

const isReaderRole = (role: string) =>
  !(INTERNAL_ROLES as readonly string[]).includes(role)

/** Следующий день даты `YYYY-MM-DD`. */
function nextDay(date: string) {
  const moment = new Date(`${date}T00:00:00Z`)
  moment.setUTCDate(moment.getUTCDate() + 1)
  return moment.toISOString().slice(0, 10)
}

/** Период МСК `[from, to]` включительно → границы UTC по началу события. */
function periodOf(input: { from: string | null; to: string | null }): Period {
  if (input.from && input.to && input.from > input.to) {
    throw new ApiError('validation_failed', { to: 'before_from' })
  }
  return {
    from: input.from ? moscowToUtc(input.from, '00:00').toISOString() : null,
    to: input.to ? moscowToUtc(nextDay(input.to), '00:00').toISOString() : null,
  }
}

function eventOption(row: {
  id: string
  title: string
  starts_at: string
}): ActivityEventOption {
  const startsAt = parseTimestamp(row.starts_at)
  return {
    id: row.id,
    title: row.title,
    startsAt: startsAt.toISOString(),
    dateMsk: utcToMoscow(startsAt).date,
  }
}

type AggregateRow = Awaited<
  ReturnType<typeof activityRepository.aggregate>
>[number]

function countsOf(row: AggregateRow) {
  return {
    visited: Number(row.visited),
    missed: Number(row.missed),
    unmarked: Number(row.unmarked),
    total: Number(row.total),
    leaders: Number(row.leaders),
  }
}

/**
 * Сводка участников (ACT-04, ACT-05, Q-49, Q-53) за период и класс:
 * текущий состав (с нулями) и все, у кого есть записи, включая чтецов.
 * Целиком одним ответом (Q-48); поиск — на клиенте.
 */
export async function activitySummary(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ActivitySummaryResponse> {
  requireRole(actor, ACCOUNTANTS)
  const input = parseBody(activitySummarySchema, body ?? {})
  const period = periodOf(input)
  const [rows, eventCount] = await Promise.all([
    activityRepository.aggregate(deps.db, {
      period,
      roles: INTERNAL_ROLES,
      withRecorded: true,
      classId: input.classId,
      limit: MEMBER_LIST_LIMIT + 1,
    }),
    activityRepository.countEvents(deps.db, period),
  ])
  const items = rows.slice(0, MEMBER_LIST_LIMIT).map((row) => {
    const counts = countsOf(row)
    return {
      userId: row.id,
      gameNickname: row.game_nickname,
      classId: row.class_id,
      className: row.class_name,
      isReader: isReaderRole(row.access_role),
      visited: counts.visited,
      missed: counts.missed,
      unmarked: counts.unmarked,
      percent: attendancePercent(counts.visited, counts.total),
    }
  })
  items.sort(compareAttendance)
  return { items, truncated: rows.length > MEMBER_LIST_LIMIT, eventCount }
}

/** Курсор истории: `[starts_at, event_id, nickname, user_id]`. */
const historyCursor = z
  .tuple([z.string().min(1).max(64), z.guid(), z.string().max(40), z.guid()])
  .transform(([startsAt, eventId, nickname, userId]) => ({
    startsAt,
    eventId,
    nickname,
    userId,
  }))

type HistoryDbRow = Awaited<
  ReturnType<typeof activityRepository.history>
>[number]

function historyRow(row: HistoryDbRow): ActivityHistoryRow {
  const event = eventOption({
    id: row.event_id,
    title: row.title,
    starts_at: row.starts_at,
  })
  return {
    eventId: event.id,
    eventTitle: event.title,
    startsAt: event.startsAt,
    dateMsk: event.dateMsk,
    userId: row.user_id,
    gameNickname: row.nickname,
    classId: row.class_id,
    className: row.class_name,
    groupName: row.group_name,
    isLeader: row.is_leader,
    status: row.status as AttendanceStatus,
    isReader: isReaderRole(row.access_role),
  }
}

const historyKey = (row: HistoryDbRow) => [
  row.starts_at,
  row.event_id,
  row.nickname,
  row.user_id,
]

/** История мероприятий (ACT-06, ACT-09): курсор, фильтры на сервере. */
export async function activityHistory(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ActivityHistoryResponse> {
  requireRole(actor, ACCOUNTANTS)
  const input = parseBody(activityHistorySchema, body ?? {})
  const rows = await activityRepository.history(deps.db, {
    period: periodOf(input),
    classId: input.classId,
    search: input.search,
    userId: null,
    after: input.cursor ? decodeCursor(historyCursor, input.cursor) : null,
    limit: input.limit + 1,
  })
  const page = splitPage(rows, input.limit, historyKey)
  return { items: page.rows.map(historyRow), nextCursor: page.nextCursor }
}

/** Курсор закрытых событий: `[starts_at, id]`. */
const eventCursor = z
  .tuple([z.string().min(1).max(64), z.guid()])
  .transform(([startsAt, eventId]) => ({ startsAt, eventId }))

/** Закрытые события периода для выбора «По мероприятию» (ACT-07). */
export async function activityEvents(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ActivityEventsResponse> {
  requireRole(actor, ACCOUNTANTS)
  const input = parseBody(activityEventsSchema, body ?? {})
  const rows = await activityRepository.events(deps.db, {
    period: periodOf(input),
    search: input.search,
    after: input.cursor ? decodeCursor(eventCursor, input.cursor) : null,
    limit: input.limit + 1,
  })
  const page = splitPage(rows, input.limit, (row) => [row.starts_at, row.id])
  return { items: page.rows.map(eventOption), nextCursor: page.nextCursor }
}

/** Состав, группы и статусы одного закрытого события (ACT-07). */
export async function activityEvent(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ActivityEventResponse> {
  requireRole(actor, ACCOUNTANTS)
  const input = parseBody(activityEventSchema, body)
  const event = await activityRepository.findClosedEvent(deps.db, input.eventId)
  if (!event) {
    throw new ApiError('not_found')
  }
  const rows = await activityRepository.eventRows(
    deps.db,
    event.id,
    input.classId,
    MEMBER_LIST_LIMIT + 1,
  )
  const shown = rows.slice(0, MEMBER_LIST_LIMIT)
  const counts = { visited: 0, missed: 0, unmarked: 0, total: shown.length }
  for (const row of shown) {
    counts[row.status as AttendanceStatus] += 1
  }
  return {
    event: eventOption(event),
    counts,
    rows: shown.map((row) => ({
      userId: row.user_id,
      gameNickname: row.nickname,
      classId: row.class_id,
      className: row.class_name,
      groupName: row.group_name,
      isLeader: row.is_leader,
      status: row.status as AttendanceStatus,
      isReader: isReaderRole(row.access_role),
    })),
    truncated: rows.length > MEMBER_LIST_LIMIT,
  }
}

/** Показатели и история одного участника за период (ACT-08). */
export async function activityMember(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ActivityMemberResponse> {
  requireRole(actor, ACCOUNTANTS)
  const input = parseBody(activityMemberSchema, body)
  const period = periodOf(input)
  const [stats, rows] = await Promise.all([
    activityRepository.memberStats(
      deps.db,
      input.userId,
      period,
      input.classId,
    ),
    activityRepository.history(deps.db, {
      period,
      classId: input.classId,
      search: null,
      userId: input.userId,
      after: input.cursor ? decodeCursor(historyCursor, input.cursor) : null,
      limit: input.limit + 1,
    }),
  ])
  const page = splitPage(rows, input.limit, historyKey)
  return {
    items: page.rows.map((row) => {
      const full = historyRow(row)
      return {
        eventId: full.eventId,
        eventTitle: full.eventTitle,
        startsAt: full.startsAt,
        dateMsk: full.dateMsk,
        classId: full.classId,
        className: full.className,
        groupName: full.groupName,
        isLeader: full.isLeader,
        status: full.status,
      }
    }),
    nextCursor: page.nextCursor,
    stats: { ...stats, percent: attendancePercent(stats.visited, stats.total) },
  }
}

/**
 * Рейтинг посещения (ACT-14–16): текущий состав целиком (Q-48, Q-53), все
 * закрытые события, число случаев пати-лидерства (Q-09), дни в гильдии.
 */
export async function attendanceRating(
  deps: AppDeps,
  actor: Actor,
): Promise<RatingResponse> {
  requireRole(actor, INTERNAL_ROLES)
  const all = { from: null, to: null }
  const [rows, eventCount] = await Promise.all([
    activityRepository.aggregate(deps.db, {
      period: all,
      roles: INTERNAL_ROLES,
      withRecorded: false,
      classId: null,
      limit: MEMBER_LIST_LIMIT + 1,
    }),
    activityRepository.countEvents(deps.db, all),
  ])
  const today = moscowDate(deps.now())
  const items = rows.slice(0, MEMBER_LIST_LIMIT).map((row) => {
    const counts = countsOf(row)
    return {
      userId: row.id,
      gameNickname: row.game_nickname,
      classId: row.class_id,
      className: row.class_name,
      visited: counts.visited,
      missed: counts.missed,
      unmarked: counts.unmarked,
      percent:
        counts.total > 0
          ? attendancePercent(counts.visited, counts.total)
          : null,
      leaderCount: counts.leaders,
      daysInGuild: daysInGuild(row.joined_on, today),
    }
  })
  items.sort(compareAttendance)
  return { items, truncated: rows.length > MEMBER_LIST_LIMIT, eventCount }
}

/**
 * Топ-5 текущего месяца МСК (ACT-12, ACT-13): текущий состав с хотя бы
 * одним посещением. Источник данных для главной этапа 10.
 */
export async function monthTop(
  deps: AppDeps,
  actor: Actor,
): Promise<MonthTopResponse> {
  requireRole(actor, INTERNAL_ROLES)
  const today = moscowDate(deps.now())
  const month = today.slice(0, 7)
  const [year, monthNumber] = month.split('-').map(Number)
  const nextMonth =
    monthNumber === 12
      ? `${year! + 1}-01`
      : `${year}-${String(monthNumber! + 1).padStart(2, '0')}`
  const period = {
    from: moscowToUtc(`${month}-01`, '00:00').toISOString(),
    to: moscowToUtc(`${nextMonth}-01`, '00:00').toISOString(),
  }
  const [rows, eventCount] = await Promise.all([
    activityRepository.aggregate(deps.db, {
      period,
      roles: INTERNAL_ROLES,
      withRecorded: false,
      classId: null,
      limit: MEMBER_LIST_LIMIT,
    }),
    activityRepository.countEvents(deps.db, period),
  ])
  const items = rows
    .map((row) => {
      const counts = countsOf(row)
      return {
        userId: row.id,
        gameNickname: row.game_nickname,
        classId: row.class_id,
        className: row.class_name,
        visited: counts.visited,
        total: counts.total,
        percent: attendancePercent(counts.visited, counts.total),
        leaderCount: counts.leaders,
      }
    })
    .filter((row) => row.visited > 0)
    .sort(compareAttendance)
    .slice(0, 5)
  return { month, eventCount, items }
}
