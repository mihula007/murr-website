import type { RecurringPreset } from '../contracts/events.ts'

/**
 * Картинки анонсов постоянных еженедельных событий (TGM-27, MAX-13, VK-10,
 * Q-114). Файлы лежат на сайте в `public/messenger/`; мессенджеры получают
 * их по адресу сайта (Telegram) или загрузкой с него (MAX, ВКонтакте).
 */
export const EVENT_IMAGE_FILES: Record<RecurringPreset, string> = {
  mtv_sat_20: 'mtv.jpg',
  sadik_sat_22: 'sad.jpg',
  tv_sun_20: 'tv20.jpg',
  tv_sun_22: 'tv22.jpg',
}

export type BroadcastImageSource = 'vote' | 'group'

const BROADCAST_IMAGE_FILES: Record<BroadcastImageSource, string> = {
  vote: 'vote.jpg',
  group: 'group-list.jpg',
}

function staticImageUrl(siteUrl: string | null, file: string): string | null {
  if (!siteUrl) {
    return null
  }
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`
  return new URL(`messenger/${file}`, base).toString()
}

/**
 * Адрес картинки события на сайте; null — у события нет картинки (не
 * постоянное) или адрес сайта не задан.
 */
export function eventImageUrl(
  siteUrl: string | null,
  preset: string | null,
): string | null {
  const file =
    preset && Object.hasOwn(EVENT_IMAGE_FILES, preset)
      ? EVENT_IMAGE_FILES[preset as RecurringPreset]
      : null
  if (!file) {
    return null
  }
  return staticImageUrl(siteUrl, file)
}

/** Картинка для отдельной рассылки из голосования или группы (BRC-18). */
export function broadcastImageUrl(
  siteUrl: string | null,
  source: BroadcastImageSource,
): string | null {
  return staticImageUrl(siteUrl, BROADCAST_IMAGE_FILES[source])
}
