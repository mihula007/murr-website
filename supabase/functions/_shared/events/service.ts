import { z } from 'zod'
import { avatarUrls } from '../account/avatars.ts'
import type { AppDeps } from '../app.ts'
import { auditPerson, writeAudit, type AuditPerson } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import {
  closeEventSchema,
  createEventSchema,
  EVENT_LIMITS,
  eventIdSchema,
  listEventsSchema,
  RECURRING_PRESET_IDS,
  RECURRING_PRESETS,
  recurringDescription,
  respondEventSchema,
  saveTemplateSchema,
  templateIdSchema,
  updateEventSchema,
  type EnsureWeeklyResponse,
  type EventAnswer,
  type EventCounts,
  type EventDetails,
  type EventListResponse,
  type EventSummary,
  type EventTemplatesResponse,
  type EventType,
  type TemplateNextResponse,
} from '../contracts/events.ts'
import type { AttendanceStatus, EventGroup } from '../contracts/groups.ts'
import {
  moscowToUtc,
  nextOccurrence,
  parseTimestamp,
  utcToMoscow,
  weekdayOf,
} from '../contracts/moscow-time.ts'
import { MEMBER_LIST_LIMIT, SMALL_LIST_LIMIT } from '../contracts/paging.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { withMessageCounts } from '../discussions/counts.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import { groupRepository } from '../groups/repository.ts'
import { eventRepository, type EventRow } from './repository.ts'

/** Читают и отвечают члены, офицеры и администраторы (ACL, EVT-04). */
const ATTENDEES = INTERNAL_ROLES
/** Создают события и шаблоны офицеры и администраторы. */
export const EVENT_MANAGERS = ['officer', 'admin'] as const

/** Курсор прошедших: `[closed_at, id]`. */
const closedCursor = z
  .tuple([z.string().min(1).max(64), z.guid()])
  .transform(([closedAt, id]) => ({ closedAt, id }))

/**
 * Право на правку и удаление (ACL-04, Q-47): администратор — любое событие;
 * офицер — своё и постоянный выпуск без автора. Событие удалённого автора
 * (не постоянное) — только администратор.
 */
export function canManageEvent(
  viewer: ProfiledActor,
  event: { created_by: string | null; recurring_preset: string | null },
) {
  const role = viewer.profile.access_role
  if (role === 'admin') {
    return true
  }
  if (role !== 'officer') {
    return false
  }
  return (
    event.created_by === viewer.userId ||
    (event.created_by === null && event.recurring_preset !== null)
  )
}

/** Ответ принимается до начала и до закрытия (Q-43). */
function answerState(
  event: { closed_at: string | null; starts_at: string },
  now: Date,
): 'open' | 'closed' | 'started' {
  if (event.closed_at !== null) {
    return 'closed'
  }
  return parseTimestamp(event.starts_at).getTime() > now.getTime()
    ? 'open'
    : 'started'
}

const emptyCounts = (): EventCounts => ({ yes: 0, maybe: 0, no: 0 })

/** Счётчики и свой ответ для набора событий — два запроса на страницу. */
async function summarize(
  deps: AppDeps,
  db: Executor,
  rows: EventRow[],
  viewer: ProfiledActor,
): Promise<EventSummary[]> {
  const ids = rows.map((row) => row.id)
  const [counts, answers] = await Promise.all([
    eventRepository.answerCounts(db, ids),
    eventRepository.answersOf(db, ids, viewer.userId),
  ])
  const now = deps.now()
  const summaries = rows.map((row) => {
    const eventCounts = emptyCounts()
    for (const count of counts) {
      if (count.eventId === row.id) {
        eventCounts[count.answer] = count.count
      }
    }
    const startsAt = parseTimestamp(row.starts_at)
    const msk = utcToMoscow(startsAt)
    return {
      id: row.id,
      title: row.title,
      type: row.event_type as EventType,
      description: row.description,
      startsAt: startsAt.toISOString(),
      dateMsk: msk.date,
      timeMsk: msk.time,
      recurring: row.recurring_preset !== null,
      createdBy: row.author_nickname
        ? { gameNickname: row.author_nickname }
        : null,
      closedAt: row.closed_at
        ? parseTimestamp(row.closed_at).toISOString()
        : null,
      counts: eventCounts,
      myAnswer: answers.get(row.id) ?? null,
      canAnswer: answerState(row, now) === 'open',
      canManage: row.closed_at === null && canManageEvent(viewer, row),
    }
  })
  return withMessageCounts(db, 'event', summaries)
}

export async function listEvents(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventListResponse> {
  const viewer = requireRole(actor, ATTENDEES)
  const { tab, cursor, limit } = parseBody(listEventsSchema, body)
  const isActive = tab === 'active'
  // «Актуальные» — малый список: целиком, но не больше порога.
  const pageLimit = isActive ? SMALL_LIST_LIMIT : limit
  const [rows, counts] = await Promise.all([
    eventRepository.list(
      deps.db,
      isActive
        ? { tab, limit: pageLimit + 1 }
        : {
            tab,
            after: cursor ? decodeCursor(closedCursor, cursor) : null,
            limit: pageLimit + 1,
          },
    ),
    eventRepository.counts(deps.db),
  ])
  const page = splitPage(rows, pageLimit, (row) => [row.closed_at, row.id])
  return {
    items: await summarize(deps, deps.db, page.rows, viewer),
    nextCursor: isActive ? null : page.nextCursor,
    activeCount: counts.active,
    pastCount: counts.past,
    truncated: isActive && rows.length > pageLimit,
  }
}

/** Группы события по порядку с участниками по порядку (GRP-03, GRP-07). */
export async function eventGroups(
  db: Executor,
  eventId: string,
): Promise<EventGroup[]> {
  const [groups, members] = await Promise.all([
    groupRepository.groups(db, eventId),
    groupRepository.members(db, eventId),
  ])
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    members: members
      .filter((member) => member.group_id === group.id)
      .map((member) => ({
        userId: member.user_id,
        isLeader: member.is_leader,
      })),
  }))
}

type PersonRow = {
  id: string
  game_nickname: string
  class_id: number
  class_name: string
  avatar_path: string | null
  answer: string | null
  status?: string
}

/**
 * Участники события: у актуального — текущий состав, ответившие и стоящие
 * в группах; у закрытого — итог закрытия с ником и классом на момент
 * закрытия (ACT-02, ACT-03).
 */
async function loadPeople(deps: AppDeps, eventId: string, closed: boolean) {
  const people: PersonRow[] = closed
    ? await groupRepository.records(deps.db, eventId, MEMBER_LIST_LIMIT + 1)
    : await eventRepository.participants(
        deps.db,
        eventId,
        INTERNAL_ROLES,
        MEMBER_LIST_LIMIT + 1,
      )
  const shown = people.slice(0, MEMBER_LIST_LIMIT)
  const urls = await avatarUrls(
    deps.storage,
    shown.map((person) => person.avatar_path),
  )
  return {
    participants: shown.map((person) => ({
      id: person.id,
      gameNickname: person.game_nickname,
      classId: person.class_id,
      className: person.class_name,
      avatarUrl: person.avatar_path
        ? (urls.get(person.avatar_path) ?? null)
        : null,
      answer: (person.answer as EventAnswer | null) ?? null,
      status: (person.status as AttendanceStatus | undefined) ?? null,
    })),
    participantsTruncated: people.length > MEMBER_LIST_LIMIT,
  }
}

/** Карточка события с участниками и группами (EVT-06, GRP). */
async function loadEventDetails(
  deps: AppDeps,
  viewer: ProfiledActor,
  id: string,
): Promise<EventDetails> {
  const row = await eventRepository.find(deps.db, id)
  if (!row) {
    throw new ApiError('not_found')
  }
  const closed = row.closed_at !== null
  const [[summary], people, groups] = await Promise.all([
    summarize(deps, deps.db, [row], viewer),
    loadPeople(deps, id, closed),
    eventGroups(deps.db, id),
  ])
  const role = viewer.profile.access_role
  return {
    ...summary!,
    ...people,
    groups,
    canManageGroups:
      !closed && (EVENT_MANAGERS as readonly string[]).includes(role),
    canClose: !closed && canManageEvent(viewer, row),
  }
}

export async function getEvent(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventDetails> {
  const viewer = requireRole(actor, ATTENDEES)
  const { id } = parseBody(eventIdSchema, body)
  return loadEventDetails(deps, viewer, id)
}

function eventTarget(id: string) {
  return { kind: 'event', id }
}

function eventDetails(
  id: string,
  values: { title: string; eventType: string; startsAt: string },
) {
  return {
    event_id: id,
    title: values.title,
    event_type: values.eventType,
    starts_at: values.startsAt,
  }
}

/** Создание события (EVT-03); дата и время — по МСК (Q-44). */
export async function createEvent(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventDetails> {
  const manager = requireRole(actor, EVENT_MANAGERS)
  const input = parseBody(createEventSchema, body)
  const values = {
    title: input.title,
    eventType: input.type,
    description: input.description,
    startsAt: moscowToUtc(input.date, input.time).toISOString(),
  }
  const id = await withTransaction(deps.db, async (tx) => {
    const eventId = await eventRepository.create(tx, {
      ...values,
      createdBy: manager.userId,
    })
    await writeAudit(tx, {
      category: 'events',
      action: 'event_created',
      summary: 'Создание события',
      actor: auditPerson(manager),
      target: eventTarget(eventId),
      details: eventDetails(eventId, values),
    })
    return eventId
  })
  return loadEventDetails(deps, manager, id)
}

/** Незакрытое событие под блокировкой; иначе not_found / state_conflict. */
export async function lockOpen(
  tx: Executor,
  id: string,
  mode: 'share' | 'update',
) {
  const event = await eventRepository.lock(tx, id, mode)
  if (!event) {
    throw new ApiError('not_found')
  }
  if (event.closed_at !== null) {
    throw new ApiError('state_conflict', { reason: 'closed' })
  }
  return event
}

async function lockManaged(tx: Executor, manager: ProfiledActor, id: string) {
  const event = await lockOpen(tx, id, 'update')
  if (!canManageEvent(manager, event)) {
    throw new ApiError('forbidden')
  }
  return event
}

/** Правка незакрытого события (EVT-03, EVT-07); ответы сохраняются. */
export async function updateEvent(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventDetails> {
  const manager = requireRole(actor, EVENT_MANAGERS)
  const input = parseBody(updateEventSchema, body)
  const values = {
    title: input.title,
    eventType: input.type,
    description: input.description,
    startsAt: moscowToUtc(input.date, input.time).toISOString(),
  }
  await withTransaction(deps.db, async (tx) => {
    const event = await lockManaged(tx, manager, input.id)
    await eventRepository.update(tx, event.id, {
      ...values,
      at: deps.now().toISOString(),
    })
    await writeAudit(tx, {
      category: 'events',
      action: 'event_updated',
      summary: 'Изменение события',
      actor: auditPerson(manager),
      target: eventTarget(event.id),
      details: eventDetails(event.id, values),
    })
  })
  return loadEventDetails(deps, manager, input.id)
}

/** Удаление незакрытого события вместе с ответами (EVT-10). */
export async function deleteEvent(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<{ deleted: true }> {
  const manager = requireRole(actor, EVENT_MANAGERS)
  const { id } = parseBody(eventIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const event = await lockManaged(tx, manager, id)
    await eventRepository.delete(tx, event.id)
    await writeAudit(tx, {
      category: 'events',
      action: 'event_deleted',
      summary: 'Удаление события',
      actor: auditPerson(manager),
      target: eventTarget(event.id),
      details: eventDetails(event.id, {
        title: event.title,
        eventType: event.event_type,
        startsAt: parseTimestamp(event.starts_at).toISOString(),
      }),
    })
  })
  return { deleted: true }
}

/**
 * Ответ или смена ответа (EVT-04, EVT-05): одна строка на участника.
 * Строка события блокируется на чтение, поэтому ответ не проходит после
 * параллельного удаления или закрытия. Только до начала (Q-43). В аудит
 * не пишется (Q-45).
 */
export async function respondToEvent(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventSummary> {
  const viewer = requireRole(actor, ATTENDEES)
  const input = parseBody(respondEventSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const event = await lockOpen(tx, input.eventId, 'share')
    const now = deps.now()
    if (answerState(event, now) === 'started') {
      throw new ApiError('state_conflict', { reason: 'started' })
    }
    await eventRepository.upsertAnswer(tx, {
      eventId: event.id,
      userId: viewer.userId,
      answer: input.answer,
      at: now.toISOString(),
    })
  })
  const row = await eventRepository.find(deps.db, input.eventId)
  if (!row) {
    throw new ApiError('not_found')
  }
  const [summary] = await summarize(deps, deps.db, [row], viewer)
  return summary!
}

/**
 * Закрытие события (EVT-08, ACT-01): одна транзакция — итог посещения
 * каждого участника, отметка закрытия и аудит. Повторное закрытие —
 * `state_conflict`, поэтому посещение не начисляется дважды. Права — как
 * на правку (EVT-07, Q-47). Закрыть можно в любой момент, в том числе без
 * групп (EVT-02).
 */
export async function closeEvent(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventDetails> {
  const manager = requireRole(actor, EVENT_MANAGERS)
  const { id } = parseBody(closeEventSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const event = await lockManaged(tx, manager, id)
    await groupRepository.writeRecords(tx, event.id, INTERNAL_ROLES)
    await groupRepository.markClosed(tx, event.id, {
      at: deps.now().toISOString(),
      by: manager.userId,
    })
    const counts = await groupRepository.recordCounts(tx, event.id)
    await writeAudit(tx, {
      category: 'events',
      action: 'event_closed',
      summary: 'Закрытие события',
      actor: auditPerson(manager),
      target: eventTarget(event.id),
      details: {
        ...eventDetails(event.id, {
          title: event.title,
          eventType: event.event_type,
          startsAt: parseTimestamp(event.starts_at).toISOString(),
        }),
        ...counts,
      },
    })
  })
  return loadEventDetails(deps, manager, id)
}

/** Сравнение секрета без раннего выхода по первому несовпадению. */
function sameSecret(given: string, expected: string) {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let index = 0; index < b.length; index += 1) {
    diff |= (a[index] ?? 0) ^ b[index]!
  }
  return diff === 0
}

/**
 * Кто запускает выпуск: офицер или администратор (кнопка) либо расписание
 * с верным `x-cron-secret` (Q-42). Без секрета у функции расписание не
 * принимается.
 */
function weeklyCaller(
  deps: AppDeps,
  actor: Actor,
  cronSecret: string | null,
): AuditPerson | null {
  if (cronSecret !== null) {
    if (!deps.cronSecret || !sameSecret(cronSecret, deps.cronSecret)) {
      throw new ApiError('forbidden')
    }
    return null
  }
  return auditPerson(requireRole(actor, EVENT_MANAGERS))
}

/**
 * Ближайшие выпуски четырёх постоянных событий (EVT-14, Q-42). Уже
 * созданные не дублируются — в том числе при гонке расписания и кнопки.
 */
export async function ensureWeeklyEvents(
  deps: AppDeps,
  actor: Actor,
  cronSecret: string | null,
): Promise<EnsureWeeklyResponse> {
  const caller = weeklyCaller(deps, actor, cronSecret)
  const now = deps.now()
  return withTransaction(deps.db, async (tx) => {
    const result: EnsureWeeklyResponse = { created: [], existing: [] }
    for (const preset of RECURRING_PRESET_IDS) {
      const spec = RECURRING_PRESETS[preset]
      const startsAt = nextOccurrence(now, spec.weekday, spec.time)
      const eventId = await eventRepository.createRecurring(tx, {
        preset,
        title: spec.title,
        eventType: 'clan',
        description: recurringDescription(spec.title),
        startsAt: startsAt.toISOString(),
      })
      if (eventId) {
        result.created.push({
          preset,
          eventId,
          startsAt: startsAt.toISOString(),
        })
      } else {
        result.existing.push(preset)
      }
    }
    if (result.created.length > 0) {
      await writeAudit(tx, {
        category: 'events',
        action: 'recurring_events_created',
        summary: 'Выпуск постоянных событий',
        actor: caller,
        details: { presets: result.created.map((item) => item.preset) },
      })
    }
    return result
  })
}

export async function listTemplates(
  deps: AppDeps,
  actor: Actor,
): Promise<EventTemplatesResponse> {
  requireRole(actor, EVENT_MANAGERS)
  const rows = await eventRepository.templates(deps.db, EVENT_LIMITS.templates)
  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.event_type as EventType,
      description: row.description,
      weekday: row.weekday,
      time: row.time_msk.slice(0, 5),
      createdBy: row.author_nickname
        ? { gameNickname: row.author_nickname }
        : null,
    })),
  }
}

function templateTarget(id: string) {
  return { kind: 'event_template', id }
}

/** Шаблон из полей формы; событие не создаётся (EVT-11). Не больше 50. */
export async function saveTemplate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventTemplatesResponse> {
  const manager = requireRole(actor, EVENT_MANAGERS)
  const input = parseBody(saveTemplateSchema, body)
  await withTransaction(deps.db, async (tx) => {
    await eventRepository.lockTemplates(tx)
    if ((await eventRepository.countTemplates(tx)) >= EVENT_LIMITS.templates) {
      throw new ApiError('validation_failed', { limit: 'too_many' })
    }
    const id = await eventRepository.createTemplate(tx, {
      title: input.title,
      eventType: input.type,
      description: input.description,
      weekday: weekdayOf(input.date),
      time: input.time,
      createdBy: manager.userId,
    })
    await writeAudit(tx, {
      category: 'events',
      action: 'event_template_created',
      summary: 'Создание шаблона события',
      actor: auditPerson(manager),
      target: templateTarget(id),
      details: { template_id: id, title: input.title },
    })
  })
  return listTemplates(deps, manager)
}

/** Любой шаблон общей библиотеки (Q-46). */
export async function deleteTemplate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventTemplatesResponse> {
  const manager = requireRole(actor, EVENT_MANAGERS)
  const { id } = parseBody(templateIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const deleted = await eventRepository.deleteTemplate(tx, id)
    if (!deleted) {
      throw new ApiError('not_found')
    }
    await writeAudit(tx, {
      category: 'events',
      action: 'event_template_deleted',
      summary: 'Удаление шаблона события',
      actor: auditPerson(manager),
      target: templateTarget(id),
      details: { template_id: id, title: deleted.title },
    })
  })
  return listTemplates(deps, manager)
}

/** Ближайшие дата и время МСК для дня недели и времени шаблона (EVT-12). */
export async function templateNextDate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<TemplateNextResponse> {
  requireRole(actor, EVENT_MANAGERS)
  const { id } = parseBody(templateIdSchema, body)
  const template = await eventRepository.findTemplate(deps.db, id)
  if (!template) {
    throw new ApiError('not_found')
  }
  const time = template.time_msk.slice(0, 5)
  const msk = utcToMoscow(nextOccurrence(deps.now(), template.weekday, time))
  return { date: msk.date, time: msk.time }
}
