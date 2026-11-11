import { z } from 'zod'
import type { AttendanceStatus, EventGroup } from './groups.ts'
import { pageRequestShape, type Page } from './paging.ts'

/** Ограничения событий и шаблонов (EVT-03, EVT-11). */
export const EVENT_LIMITS = {
  title: 80,
  description: 2000,
  /** Шаблоны — малый список (реестр списков, 12.11.2026). */
  templates: 50,
} as const

export const EVENT_TYPES = ['pvp', 'pve', 'clan'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  pvp: 'PvP',
  pve: 'PvE',
  clan: 'Клановое',
}

/** Ответы участника (EVT-04). */
export const EVENT_ANSWERS = ['yes', 'maybe', 'no'] as const
export type EventAnswer = (typeof EVENT_ANSWERS)[number]

export const EVENT_ANSWER_LABELS: Record<EventAnswer, string> = {
  yes: 'Приду',
  maybe: '50/50',
  no: 'Не приду',
}

/**
 * Четыре постоянных еженедельных события по МСК (EVT-14, Q-08, Q-42).
 * 0 — воскресенье, 6 — суббота.
 */
export const RECURRING_PRESETS = {
  mtv_sat_20: { title: 'МТВ', weekday: 6, time: '20:00' },
  sadik_sat_22: { title: 'Садик', weekday: 6, time: '22:00' },
  tv_sun_20: { title: 'ТВ', weekday: 0, time: '20:00' },
  tv_sun_22: { title: 'ТВ', weekday: 0, time: '22:00' },
} as const
export type RecurringPreset = keyof typeof RECURRING_PRESETS
export const RECURRING_PRESET_IDS = Object.keys(
  RECURRING_PRESETS,
) as RecurringPreset[]

export function recurringDescription(title: string) {
  return `Еженедельное мероприятие клана «${title}».`
}

export const WEEKDAY_LABELS = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
] as const

export const EVENT_TABS = ['active', 'past'] as const
export type EventTab = (typeof EVENT_TABS)[number]

const titleSchema = z
  .string('required')
  .trim()
  .min(1, 'required')
  .max(EVENT_LIMITS.title, 'too_long')

const descriptionSchema = z
  .string('required')
  .trim()
  .min(1, 'required')
  .max(EVENT_LIMITS.description, 'too_long')

const typeSchema = z.enum(EVENT_TYPES, 'required')

/** Дата МСК `YYYY-MM-DD`, существующая в календаре. */
export const eventDateSchema = z
  .string('required')
  .min(1, 'required')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year!, month! - 1, day!))
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    )
  }, 'invalid')

/** Время МСК `HH:MM`. */
export const eventTimeSchema = z
  .string('required')
  .min(1, 'required')
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid')

/** Поля формы события: дата и время — по МСК (Q-44). */
export const eventFieldsSchema = z.object({
  title: titleSchema,
  type: typeSchema,
  date: eventDateSchema,
  time: eventTimeSchema,
  description: descriptionSchema,
})
export type EventFields = z.input<typeof eventFieldsSchema>

export const createEventSchema = eventFieldsSchema
export type CreateEventRequest = z.input<typeof createEventSchema>

export const updateEventSchema = eventFieldsSchema.extend({
  id: z.guid('not_found'),
})
export type UpdateEventRequest = z.input<typeof updateEventSchema>

export const eventIdSchema = z.object({ id: z.guid('not_found') })

export const closeEventSchema = eventIdSchema
export type CloseEventRequest = z.input<typeof closeEventSchema>

export const respondEventSchema = z.object({
  eventId: z.guid('not_found'),
  answer: z.enum(EVENT_ANSWERS, 'invalid'),
})
export type RespondEventRequest = z.input<typeof respondEventSchema>

/**
 * «Актуальные» — малый список (≤ 50), отдаётся целиком.
 * «Прошедшие» — большой, страницы по курсору `(closed_at, id)`.
 */
export const listEventsSchema = z.object({
  tab: z.enum(EVENT_TABS),
  ...pageRequestShape,
})
export type ListEventsRequest = z.input<typeof listEventsSchema>

/** Шаблон сохраняется из полей формы; день недели — по дате МСК (EVT-11). */
export const saveTemplateSchema = eventFieldsSchema
export type SaveTemplateRequest = z.input<typeof saveTemplateSchema>

export const templateIdSchema = z.object({ id: z.guid('not_found') })

export type EventCounts = Record<EventAnswer, number>

export type EventSummary = {
  id: string
  title: string
  type: EventType
  description: string
  /** Момент начала, ISO UTC. */
  startsAt: string
  /** Дата и время начала по МСК. */
  dateMsk: string
  timeMsk: string
  /** Постоянный выпуск — автор «Автоматически» (Q-47). */
  recurring: boolean
  /** Ник автора; null — автора нет (постоянный) или пользователь удалён. */
  createdBy: { gameNickname: string } | null
  closedAt: string | null
  counts: EventCounts
  /** Ответ текущего пользователя; null — не отвечал. */
  myAnswer: EventAnswer | null
  /** Ответ ещё принимается: не закрыто и не началось (Q-43). */
  canAnswer: boolean
  /** Текущий пользователь может править и удалять (ACL-04, Q-47). */
  canManage: boolean
}

export type EventParticipant = {
  id: string
  /** У закрытого события — ник и класс на момент закрытия (ACT-03). */
  gameNickname: string
  classId: number
  className: string
  avatarUrl: string | null
  /** null — «Без ответа». */
  answer: EventAnswer | null
  /** Итог посещения; только у закрытого события. */
  status: AttendanceStatus | null
}

export type EventDetails = EventSummary & {
  /**
   * Актуальное событие: текущий состав, ответившие и стоящие в группах;
   * закрытое — участники итога закрытия (ACT-02).
   */
  participants: EventParticipant[]
  /** Участников больше порога `MEMBER_LIST_LIMIT`: показана часть. */
  participantsTruncated: boolean
  /** Группы по порядку создания, участники — по порядку в группе. */
  groups: EventGroup[]
  /** Офицер или администратор может менять группы (актуальное событие). */
  canManageGroups: boolean
  /** Текущий пользователь может закрыть событие (EVT-07, Q-47). */
  canClose: boolean
}

export type EventListResponse = Page<EventSummary> & {
  activeCount: number
  pastCount: number
  /** «Актуальные»: событий больше порога, показаны ближайшие. */
  truncated: boolean
}

export type EnsureWeeklyResponse = {
  created: { preset: RecurringPreset; eventId: string; startsAt: string }[]
  existing: RecurringPreset[]
}

export type EventTemplate = {
  id: string
  title: string
  type: EventType
  description: string
  weekday: number
  time: string
  createdBy: { gameNickname: string } | null
}

export type EventTemplatesResponse = { items: EventTemplate[] }

/** Ближайшая дата и время МСК для шаблона (EVT-12). */
export type TemplateNextResponse = { date: string; time: string }
