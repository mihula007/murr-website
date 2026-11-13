import type { NotificationTarget } from '@contracts/notifications'
import type { AccessRole } from '@/app/access'

/** Маршрут перехода по уведомлению; параметры — для `navigate`. */
export type NotificationRoute =
  | { to: '/events/$id'; params: { id: string } }
  | { to: '/votes/$id'; params: { id: string } }
  | { to: '/publications/$id'; params: { id: string } }
  | { to: '/market/$id'; params: { id: string } }
  | { to: '/applications/$id'; params: { id: string } }
  | { to: '/account' }

/**
 * Переход к объекту уведомления (NTF-06). Ссылка доступа не даёт: удалённый
 * или закрытый объект открывает состояние страницы «Не найдено» или «Нет
 * доступа» без данных (NTF-07). Неизвестный вид — без перехода.
 */
export function notificationRoute(
  target: NotificationTarget | null,
  role: AccessRole,
): NotificationRoute | null {
  if (!target) {
    return null
  }
  const params = { id: target.id }
  switch (target.kind) {
    case 'event':
      return { to: '/events/$id', params }
    case 'vote':
      return { to: '/votes/$id', params }
    case 'publication':
      return { to: '/publications/$id', params }
    case 'market_listing':
      return { to: '/market/$id', params }
    case 'join_application':
      // Кандидат видит свою заявку в кабинете, офицер — в разделе заявок.
      return role === 'officer' || role === 'admin'
        ? { to: '/applications/$id', params }
        : { to: '/account' }
    case 'account':
      return { to: '/account' }
    default:
      return null
  }
}
