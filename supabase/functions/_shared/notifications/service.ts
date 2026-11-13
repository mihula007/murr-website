import type { AppDeps } from '../app.ts'
import { requireRole, type Actor } from '../auth/actor.ts'
import type { AccessRole } from '../contracts/account.ts'
import {
  NEWS_SECTION_ROLES,
  NOTIFICATION_LIMITS,
  NOTIFICATION_VIEWERS,
  newsSectionsFor,
  notificationIdSchema,
  sectionSeenSchema,
  type NewsSection,
  type NotificationKind,
  type NotificationListResponse,
  type NotificationReadResponse,
  type NotificationSummaryResponse,
} from '../contracts/notifications.ts'
import type { Executor } from '../db/client.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { notificationRepository, sectionViewRepository } from './repository.ts'

export type { NotificationKind }

export type ObjectRef = { kind: string; id: string }

export type Notification = {
  recipientId: string
  /** Инициатор действия; null — система. */
  actorId: string | null
  kind: NotificationKind
  title: string
  body?: string
  /** Куда ведёт уведомление; доступа к объекту не даёт. */
  target?: ObjectRef
  /** Действие-источник: повтор с тем же источником не дублирует уведомление. */
  source: ObjectRef
}

/**
 * Единая точка создания личного уведомления (APP-14, Q-36). Вызывается внутри
 * транзакции операции. Инициатор о собственном действии не уведомляется.
 * Возвращает id созданного уведомления или null.
 */
export async function notify(tx: Executor, notification: Notification) {
  if (notification.actorId === notification.recipientId) {
    return null
  }
  const id = await notificationRepository.insertOnce(tx, {
    recipient_id: notification.recipientId,
    actor_id: notification.actorId,
    kind: notification.kind,
    title: notification.title,
    body: notification.body ?? '',
    target_kind: notification.target?.kind ?? null,
    target_id: notification.target?.id ?? null,
    source_kind: notification.source.kind,
    source_id: notification.source.id,
  })
  return id ?? null
}

const iso = (value: string) => new Date(value).toISOString()

/** Последние уведомления своей истории (NTF-01, NTF-02, Q-64). */
export async function listNotifications(
  deps: AppDeps,
  actor: Actor,
): Promise<NotificationListResponse> {
  const viewer = requireRole(actor, NOTIFICATION_VIEWERS)
  const [rows, unreadCount] = await Promise.all([
    notificationRepository.recent(
      deps.db,
      viewer.userId,
      NOTIFICATION_LIMITS.panel,
    ),
    notificationRepository.unreadCount(deps.db, viewer.userId),
  ])
  return {
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind as NotificationKind,
      title: row.title,
      body: row.body,
      target:
        row.target_kind && row.target_id
          ? { kind: row.target_kind, id: row.target_id }
          : null,
      createdAt: iso(row.created_at),
      readAt: row.read_at ? iso(row.read_at) : null,
    })),
    unreadCount,
  }
}

/** Отмечает одно своё уведомление прочитанным (NTF-05); чужое — not_found. */
export async function readNotification(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<NotificationReadResponse> {
  const viewer = requireRole(actor, NOTIFICATION_VIEWERS)
  const { id } = parseBody(notificationIdSchema, body)
  const found = await notificationRepository.markRead(
    deps.db,
    viewer.userId,
    id,
    deps.now(),
  )
  if (!found) {
    throw new ApiError('not_found')
  }
  return {
    unreadCount: await notificationRepository.unreadCount(
      deps.db,
      viewer.userId,
    ),
  }
}

/**
 * «Прочитать все» (NTF-05): все непрочитанные получателя, включая не
 * попавшие в панель, — иначе значок не обнулится. История сохраняется.
 */
export async function readAllNotifications(
  deps: AppDeps,
  actor: Actor,
): Promise<NotificationReadResponse> {
  const viewer = requireRole(actor, NOTIFICATION_VIEWERS)
  await notificationRepository.markAllRead(deps.db, viewer.userId, deps.now())
  return { unreadCount: 0 }
}

/**
 * Опрос шапки (Q-66): непрочитанные и новизна доступных роли разделов
 * (NTF-09–12, Q-67). Первый доступ к разделу ставит отметку и даёт 0.
 */
export async function notificationSummary(
  deps: AppDeps,
  actor: Actor,
): Promise<NotificationSummaryResponse> {
  const viewer = requireRole(actor, NOTIFICATION_VIEWERS)
  const role = viewer.profile.access_role as AccessRole
  const sections = newsSectionsFor(role)
  const seen = await sectionViewRepository.ensure(
    deps.db,
    viewer.userId,
    sections,
    deps.now(),
  )
  const [unreadCount, ...counts] = await Promise.all([
    notificationRepository.unreadCount(deps.db, viewer.userId),
    ...sections.map((section) =>
      sectionViewRepository.countNew(deps.db, section, {
        userId: viewer.userId,
        since: seen.get(section) ?? deps.now().toISOString(),
        cap: NOTIFICATION_LIMITS.sectionCap,
      }),
    ),
  ])
  const result: Partial<Record<NewsSection, number>> = {}
  sections.forEach((section, index) => {
    result[section] = counts[index] ?? 0
  })
  return { unreadCount: unreadCount ?? 0, sections: result }
}

/** Открытие раздела снимает его новизну только у себя (NTF-11). */
export async function markSectionSeen(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<{ ok: true }> {
  requireRole(actor, NOTIFICATION_VIEWERS)
  const { section } = parseBody(sectionSeenSchema, body)
  const viewer = requireRole(actor, NEWS_SECTION_ROLES[section])
  await sectionViewRepository.markSeen(
    deps.db,
    viewer.userId,
    section,
    deps.now(),
  )
  return { ok: true }
}
