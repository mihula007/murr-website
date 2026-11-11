import { z } from 'zod'
import { eventDateSchema } from './events.ts'
import type { AttendanceStatus } from './groups.ts'
import { pageRequestShape, type MemberList, type Page } from './paging.ts'

/*
 * Учёт активности и рейтинг (ACT). Источник — итог закрытых событий
 * (`event_activity_records`). Дата мероприятия — дата начала по МСК (Q-50).
 */

/**
 * Предел строк истории в одной выгрузке Excel: страховка памяти браузера.
 * 200 участников × 250 событий; при превышении интерфейс сообщает об обрезке.
 */
export const ACTIVITY_EXPORT_LIMIT = 50_000

/** Процент посещения (ACT-05, Q-49): округление до целого, без записей — 0. */
export function attendancePercent(visited: number, total: number) {
  return total > 0 ? Math.round((visited / total) * 100) : 0
}

/**
 * Полные сутки в гильдии от даты вступления до сегодняшней даты МСК
 * (ACT-15). Без даты или с датой в будущем — null («—»).
 */
export function daysInGuild(joinedOn: string | null, todayMsk: string) {
  if (!joinedOn) {
    return null
  }
  const days = Math.floor(
    (Date.parse(`${todayMsk}T00:00:00Z`) -
      Date.parse(`${joinedOn}T00:00:00Z`)) /
      86_400_000,
  )
  return days >= 0 ? days : null
}

/**
 * Порядок сводки, рейтинга и топ-5 (ACT-12): посещения, процент, ник.
 */
export function compareAttendance(
  a: { visited: number; percent: number | null; gameNickname: string },
  b: { visited: number; percent: number | null; gameNickname: string },
) {
  return (
    b.visited - a.visited ||
    (b.percent ?? -1) - (a.percent ?? -1) ||
    a.gameNickname.localeCompare(b.gameNickname, 'ru-RU')
  )
}

const optionalDate = eventDateSchema
  .nullish()
  .transform((value) => value ?? null)

/**
 * Общие фильтры учёта (ACT-09): период по дате начала МСК (включительно)
 * и класс. Поиск — у больших списков; у сводки — на клиенте (Q-48).
 */
export const activityFilterShape = {
  from: optionalDate,
  to: optionalDate,
  classId: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
}

const searchSchema = z
  .string()
  .trim()
  .max(40, 'too_long')
  .nullish()
  .transform((value) => value || null)

export const activitySummarySchema = z.object(activityFilterShape)
export type ActivitySummaryRequest = z.input<typeof activitySummarySchema>

export const activityHistorySchema = z.object({
  ...activityFilterShape,
  search: searchSchema,
  ...pageRequestShape,
})
export type ActivityHistoryRequest = z.input<typeof activityHistorySchema>

export const activityEventsSchema = z.object({
  from: optionalDate,
  to: optionalDate,
  search: searchSchema,
  ...pageRequestShape,
})
export type ActivityEventsRequest = z.input<typeof activityEventsSchema>

export const activityEventSchema = z.object({
  eventId: z.guid('not_found'),
  classId: activityFilterShape.classId,
})
export type ActivityEventRequest = z.input<typeof activityEventSchema>

export const activityMemberSchema = z.object({
  userId: z.guid('not_found'),
  ...activityFilterShape,
  ...pageRequestShape,
})
export type ActivityMemberRequest = z.input<typeof activityMemberSchema>

export type AttendanceCounts = {
  visited: number
  missed: number
  unmarked: number
}

/** Строка сводки учёта (ACT-04): без пати-лидерства (Q-09). */
export type ActivitySummaryRow = AttendanceCounts & {
  userId: string
  gameNickname: string
  classId: number
  className: string
  /** Вышел из клана — пометка «Чтец» (Q-53). */
  isReader: boolean
  percent: number
}

export type ActivitySummaryResponse = MemberList<ActivitySummaryRow> & {
  /** Закрытых мероприятий в периоде. */
  eventCount: number
}

/** Строка истории (ACT-06): ник и класс — из итога закрытия. */
export type ActivityHistoryRow = {
  eventId: string
  eventTitle: string
  startsAt: string
  dateMsk: string
  userId: string
  gameNickname: string
  classId: number
  className: string
  groupName: string | null
  isLeader: boolean
  status: AttendanceStatus
  isReader: boolean
}

export type ActivityHistoryResponse = Page<ActivityHistoryRow>

export type ActivityEventOption = {
  id: string
  title: string
  startsAt: string
  dateMsk: string
}

export type ActivityEventsResponse = Page<ActivityEventOption>

/** «По мероприятию» (ACT-07): состав, группы и статусы одного события. */
export type ActivityEventResponse = {
  event: ActivityEventOption
  counts: AttendanceCounts & { total: number }
  rows: Omit<
    ActivityHistoryRow,
    'eventId' | 'eventTitle' | 'startsAt' | 'dateMsk'
  >[]
  truncated: boolean
}

/** «По участнику» (ACT-08): показатели за период и история по курсору. */
export type ActivityMemberResponse = Page<
  Omit<ActivityHistoryRow, 'userId' | 'gameNickname' | 'isReader'>
> & {
  stats: AttendanceCounts & { total: number; percent: number }
}

/** Строка рейтинга посещения (ACT-14, ACT-15). */
export type RatingRow = AttendanceCounts & {
  userId: string
  gameNickname: string
  classId: number
  className: string
  /** null — записей нет («—»). */
  percent: number | null
  /** Случаи пати-лидерства (Q-09). */
  leaderCount: number
  /** Полные сутки в гильдии; null — дата вступления неизвестна («—»). */
  daysInGuild: number | null
}

export type RatingResponse = MemberList<RatingRow> & { eventCount: number }

/** Топ-5 текущего месяца МСК для главной (ACT-12, ACT-13). */
export type MonthTopResponse = {
  /** `YYYY-MM` по МСК. */
  month: string
  eventCount: number
  items: MonthTopRow[]
}

export type MonthTopRow = Pick<
  RatingRow,
  | 'userId'
  | 'gameNickname'
  | 'classId'
  | 'className'
  | 'visited'
  | 'leaderCount'
> & { total: number; percent: number }
