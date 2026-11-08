import {
  ADMIN_ROLES,
  INTERNAL_ROLES,
  MANAGER_ROLES,
  hasRole,
  type AccessRole,
} from './access'

export type NavCategoryId = 'clan' | 'community' | 'management'

export type NavSection = {
  id: string
  path: `/${string}`
  label: string
  category: NavCategoryId
  roles: readonly AccessRole[]
}

export type NavSectionConfig = (typeof NAV_SECTIONS)[number]
export type NavSectionId = NavSectionConfig['id']

export type NavCategory = {
  id: NavCategoryId
  label: string
  sections: NavSectionConfig[]
}

export const NAV_CATEGORIES: readonly { id: NavCategoryId; label: string }[] = [
  { id: 'clan', label: 'Клан' },
  { id: 'community', label: 'Сообщество' },
  { id: 'management', label: 'Управление' },
]

// Единая таблица видимости меню и доступа к маршрутам (ACL, HOM-02).
export const NAV_SECTIONS = [
  {
    id: 'events',
    path: '/events',
    label: 'Ивенты',
    category: 'clan',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'votes',
    path: '/votes',
    label: 'Голосование',
    category: 'clan',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'roster',
    path: '/roster',
    label: 'Состав',
    category: 'clan',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'publications',
    path: '/publications',
    label: 'Публикации',
    category: 'community',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'market',
    path: '/market',
    label: 'Внутри клана',
    category: 'community',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'rating',
    path: '/rating',
    label: 'Рейтинг посещения',
    category: 'community',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'applications',
    path: '/applications',
    label: 'Заявки',
    category: 'management',
    roles: MANAGER_ROLES,
  },
  {
    id: 'activity',
    path: '/activity',
    label: 'Учёт активности',
    category: 'management',
    roles: MANAGER_ROLES,
  },
  {
    id: 'broadcast',
    path: '/broadcast',
    label: 'Рассылка',
    category: 'management',
    roles: MANAGER_ROLES,
  },
  {
    id: 'admin',
    path: '/admin',
    label: 'Администрирование',
    category: 'management',
    roles: ADMIN_ROLES,
  },
] as const satisfies readonly NavSection[]

export function visibleNavigation(role: AccessRole): NavCategory[] {
  return NAV_CATEGORIES.map((category) => ({
    ...category,
    sections: NAV_SECTIONS.filter(
      (section) =>
        section.category === category.id && hasRole(role, section.roles),
    ),
  })).filter((category) => category.sections.length > 0)
}

export function findSectionByPath(path: string): NavSectionConfig | undefined {
  return NAV_SECTIONS.find(
    (section) => path === section.path || path.startsWith(`${section.path}/`),
  )
}

/** Пути вне таблицы разделов (главная, кабинет) не ограничиваются. */
export function canAccessPath(role: AccessRole, path: string) {
  const section = findSectionByPath(path)
  return section ? hasRole(role, section.roles) : true
}
