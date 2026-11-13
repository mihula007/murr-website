import { z } from 'zod'
import type { AccessRole } from './account.ts'

/** Ограничения колокольчика и счётчиков разделов (Q-64, Q-66). */
export const NOTIFICATION_LIMITS = {
  /** Последние уведомления в панели; старые хранятся, но не показываются. */
  panel: 50,
  /** Счёт новизны раздела останавливается на этом числе (меню — «99+»). */
  sectionCap: 100,
  /** Опрос колокольчика и счётчиков при видимой вкладке. */
  pollMs: 60 * 1000,
} as const

/** Кто видит колокольчик (NTF-01, HOM-01, HOM-10): не гость и не чтец. */
export const NOTIFICATION_VIEWERS = [
  'applicant',
  'member',
  'officer',
  'admin',
] as const satisfies readonly AccessRole[]

/** Виды личных уведомлений; совпадают с CHECK в миграциях этапов 4, 9, 10. */
export const NOTIFICATION_KINDS = [
  'application_accepted',
  'application_rejected',
  'discussion_mention',
  'discussion_reply',
  'group_added',
  'group_leader',
  'role_changed',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** Разделы со счётчиком новых объектов (NTF-09). */
export const NEWS_SECTIONS = [
  'events',
  'votes',
  'publications',
  'market',
  'applications',
  'accounts',
] as const
export type NewsSection = (typeof NEWS_SECTIONS)[number]

const INTERNAL = ['member', 'officer', 'admin'] as const

/** Кому доступен счётчик раздела — те же роли, что у раздела (NTF-09). */
export const NEWS_SECTION_ROLES: Record<NewsSection, readonly AccessRole[]> = {
  events: INTERNAL,
  votes: INTERNAL,
  publications: INTERNAL,
  market: INTERNAL,
  applications: ['officer', 'admin'],
  accounts: ['admin'],
}

export function newsSectionsFor(role: AccessRole): NewsSection[] {
  return NEWS_SECTIONS.filter((section) =>
    NEWS_SECTION_ROLES[section].includes(role),
  )
}

/** Ссылка уведомления на объект; доступа к объекту не даёт (NTF-07). */
export type NotificationTarget = { kind: string; id: string }

export type NotificationItem = {
  id: string
  kind: NotificationKind
  title: string
  body: string
  target: NotificationTarget | null
  createdAt: string
  readAt: string | null
}

/** Последние `NOTIFICATION_LIMITS.panel` уведомлений и число всех непрочитанных. */
export type NotificationListResponse = {
  items: NotificationItem[]
  unreadCount: number
}

/** Ответ опроса шапки (Q-66): непрочитанные и новизна доступных разделов. */
export type NotificationSummaryResponse = {
  unreadCount: number
  sections: Partial<Record<NewsSection, number>>
}

export type NotificationReadResponse = { unreadCount: number }

export const notificationIdSchema = z.object({ id: z.guid('not_found') })

export const sectionSeenSchema = z.object({ section: z.enum(NEWS_SECTIONS) })
