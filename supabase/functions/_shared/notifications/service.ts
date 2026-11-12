import type { Executor } from '../db/client.ts'
import { notificationRepository } from './repository.ts'

/** Виды личных уведомлений; совпадают с CHECK в миграциях этапов 4 и 9. */
export type NotificationKind =
  | 'application_accepted'
  | 'application_rejected'
  | 'discussion_mention'
  | 'discussion_reply'

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
