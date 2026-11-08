import { useRouterState } from '@tanstack/react-router'
import { findSectionByPath } from '@/app/navigation'

/** Раздел меню, к которому относится текущий адрес. */
export function useActiveSection() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return { pathname, section: findSectionByPath(pathname) }
}
