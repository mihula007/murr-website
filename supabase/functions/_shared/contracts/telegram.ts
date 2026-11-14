/**
 * Привязка Telegram (TGM-01–TGM-10). Сопоставление — по числовому ID
 * Telegram на сервере; клиент видит только состояние и ссылку на бота.
 */

/** Код привязки действует 15 минут (TGM-03, Q-89). */
export const TELEGRAM_LINK_TTL_MINUTES = 15

export type TelegramStatus = {
  /** false — на сервере не задан бот: привязка недоступна. */
  configured: boolean
  linked: boolean
  /** @username для показа; null — у пользователя Telegram его нет. */
  username: string | null
  displayName: string | null
  /** Пользователь остановил бота: анонсы не приходят (TGM-08). */
  blocked: boolean
}

export type TelegramLinkStart = {
  /** `https://t.me/<бот>?start=<код>` — одноразовая ссылка. */
  url: string
  expiresAt: string
}
