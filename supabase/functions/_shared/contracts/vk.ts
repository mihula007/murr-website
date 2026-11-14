/**
 * Привязка ВКонтакте (VK-01–VK-04). Сопоставление — по числовому ID
 * пользователя ВКонтакте на сервере; клиент видит только состояние и ссылку.
 */

/** Код привязки действует 15 минут (как TGM-03). */
export const VK_LINK_TTL_MINUTES = 15

export type VkStatus = {
  /** false — на сервере не задан бот сообщества: привязка недоступна. */
  configured: boolean
  linked: boolean
  /** Короткий адрес для показа; null — его нет. */
  username: string | null
  displayName: string | null
  /** Сообщения от сообщества запрещены: анонсы не приходят (VK-03). */
  blocked: boolean
}

export type VkLinkStart = {
  /** `https://vk.me/<сообщество>?ref=<код>` — одноразовая ссылка. */
  url: string
  expiresAt: string
}
