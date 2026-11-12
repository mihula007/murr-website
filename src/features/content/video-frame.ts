import type { VideoProvider } from '@contracts/rich-text'

const TITLES: Record<VideoProvider, string> = {
  youtube: 'Видео YouTube',
  vk: 'Видео VK',
}

/**
 * Атрибуты встроенного плеера (Q-56) — одни для редактора и для показа.
 * Песочница разрешает только то, что нужно плееру; адрес собирается из
 * проверенного идентификатора (`videoEmbedUrl`), а не из присланного URL.
 */
export const VIDEO_SANDBOX =
  'allow-scripts allow-same-origin allow-presentation allow-popups'
export const VIDEO_ALLOW =
  'fullscreen; picture-in-picture; encrypted-media; autoplay'
export const VIDEO_REFERRER_POLICY = 'strict-origin-when-cross-origin'

export const videoTitle = (provider: VideoProvider) => TITLES[provider]

/** Атрибуты для DOM-описания узла в редакторе. */
export function videoFrameAttributes(provider: VideoProvider) {
  return {
    title: videoTitle(provider),
    sandbox: VIDEO_SANDBOX,
    allow: VIDEO_ALLOW,
    referrerpolicy: VIDEO_REFERRER_POLICY,
    loading: 'lazy',
    allowfullscreen: 'true',
  }
}
