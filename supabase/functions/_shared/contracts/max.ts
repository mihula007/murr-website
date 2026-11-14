/**
 * Привязка MAX (MAX-01–MAX-04). Сопоставление — по числовому ID MAX на
 * сервере; клиент видит только состояние и ссылку на бота.
 */

/** Код привязки действует 15 минут (как TGM-03). */
export const MAX_LINK_TTL_MINUTES = 15

export type MaxStatus = {
  /** false — на сервере не задан бот: привязка недоступна. */
  configured: boolean
  linked: boolean
  /** Username для показа; null — у пользователя MAX его нет. */
  username: string | null
  displayName: string | null
  /** Пользователь остановил бота: анонсы не приходят (MAX-03). */
  blocked: boolean
}

export type MaxLinkStart = {
  /** `https://max.ru/<бот>?start=<код>` — одноразовая ссылка. */
  url: string
  expiresAt: string
}
