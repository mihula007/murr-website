import { useEffect } from 'react'
import type { NewsSection } from '@contracts/notifications'
import { useAccess } from '@/app/access'
import type { NavSectionId } from '@/app/navigation'
import { useActiveSection } from '@/app/shell/use-active-section'
import { useMarkSectionSeen, useNotificationSummary } from './api'
import { canSeeNotifications } from './notification-bell'

/** Раздел счётчика новизны → пункт меню (NTF-09; аккаунты — в администрировании). */
const SECTION_NAV: Record<NewsSection, NavSectionId> = {
  events: 'events',
  votes: 'votes',
  publications: 'publications',
  market: 'market',
  applications: 'applications',
  accounts: 'admin',
}

const NAV_SECTION = Object.fromEntries(
  Object.entries(SECTION_NAV).map(([news, nav]) => [nav, news]),
) as Partial<Record<NavSectionId, NewsSection>>

/**
 * Данные шапки: непрочитанные и счётчики меню из одного опроса (Q-66).
 * Пока открыт раздел с новыми объектами, его новизна снимается (NTF-11).
 */
export function useHeaderNotifications() {
  const { role, status } = useAccess()
  const enabled = status === 'ready' && canSeeNotifications(role)
  const summary = useNotificationSummary(enabled)
  const markSeen = useMarkSectionSeen()
  const { section: active } = useActiveSection()

  const sections = enabled ? summary.data?.sections : undefined
  const activeNews = active ? NAV_SECTION[active.id] : undefined
  const activeCount = activeNews ? (sections?.[activeNews] ?? 0) : 0
  const { mutate } = markSeen
  useEffect(() => {
    if (activeNews && activeCount > 0) {
      mutate(activeNews)
    }
  }, [activeNews, activeCount, mutate])

  const counts: Partial<Record<string, number>> = {}
  for (const [news, count] of Object.entries(sections ?? {})) {
    counts[SECTION_NAV[news as NewsSection]] = count
  }
  return {
    showBell: enabled,
    unreadCount: enabled ? summary.data?.unreadCount : undefined,
    counts,
  }
}
