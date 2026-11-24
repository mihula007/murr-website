import {
  ADMIN_ROLES,
  INTERNAL_ROLES,
  MANAGER_ROLES,
  hasRole,
  type AccessRole,
} from './access'
import type { OfficerPermissionCode } from '@contracts/officer-permissions'

export type NavCategoryId = 'clan' | 'community' | 'management' | 'forge'

export type NavSection = {
  id: string
  path: `/${string}`
  label: string
  category: NavCategoryId
  roles: readonly AccessRole[]
  permissions?: readonly OfficerPermissionCode[]
  permissionMode?: 'all' | 'any'
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
  { id: 'forge', label: 'Кузня' },
  { id: 'management', label: 'Управление' },
]

// Единая таблица видимости меню и доступа к маршрутам (ACL, HOM-02).
export const NAV_SECTIONS = [
  {
    id: 'gods',
    path: '/forge/gods',
    label: 'Боги',
    category: 'forge',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'rings',
    path: '/forge/rings',
    label: 'Кольца',
    category: 'forge',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'robe',
    path: '/forge/robe',
    label: 'Плащ',
    category: 'forge',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'equipment',
    path: '/forge/equipment',
    label: 'Эквип',
    category: 'forge',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'night-weapon',
    path: '/forge/night-weapon',
    label: 'Пуха',
    category: 'forge',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'chienkun',
    path: '/forge/chienkun',
    label: 'Мирозданки',
    category: 'forge',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'titles',
    path: '/forge/titles',
    label: 'Жребия',
    category: 'forge',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'events',
    path: '/events',
    label: 'События',
    category: 'clan',
    roles: INTERNAL_ROLES,
  },
  {
    id: 'kh',
    path: '/kh',
    label: 'КХ',
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
    permissions: ['applications.review'],
  },
  {
    id: 'activity',
    path: '/activity',
    label: 'Учёт активности',
    category: 'management',
    roles: MANAGER_ROLES,
    permissions: ['activity.view_export'],
  },
  {
    id: 'broadcast',
    path: '/broadcast',
    label: 'Рассылка',
    category: 'management',
    roles: MANAGER_ROLES,
    permissions: [
      'broadcasts.send',
      'broadcasts.templates',
      'broadcasts.subscriptions',
    ],
    permissionMode: 'any',
  },
  {
    id: 'permissions',
    path: '/permissions',
    label: 'Мастерка',
    category: 'management',
    roles: ['master', 'admin'],
  },
  {
    id: 'admin',
    path: '/admin',
    label: 'Администрирование',
    category: 'management',
    roles: ADMIN_ROLES,
  },
] as const satisfies readonly NavSection[]

export function visibleNavigation(
  role: AccessRole,
  permissions: readonly OfficerPermissionCode[] = [],
): NavCategory[] {
  return NAV_CATEGORIES.map((category) => ({
    ...category,
    sections: NAV_SECTIONS.filter(
      (section) =>
        section.category === category.id &&
        hasRole(role, section.roles) &&
        hasSectionPermission(role, permissions, section),
    ),
  })).filter((category) => category.sections.length > 0)
}

/** Роли раздела из той же таблицы — для `RouteGate` реализованных разделов. */
export function sectionRoles(id: NavSectionId): readonly AccessRole[] {
  const section = (NAV_SECTIONS as readonly NavSection[]).find(
    (item) => item.id === id,
  )
  if (!section) {
    throw new Error(`Нет раздела ${id} в навигации`)
  }
  return section.roles
}

export function sectionPermissions(
  id: NavSectionId,
): readonly OfficerPermissionCode[] {
  return (
    (NAV_SECTIONS as readonly NavSection[]).find((item) => item.id === id)
      ?.permissions ?? []
  )
}

export function sectionPermissionMode(
  id: NavSectionId,
): 'all' | 'any' | undefined {
  return (NAV_SECTIONS as readonly NavSection[]).find((item) => item.id === id)
    ?.permissionMode
}

function hasSectionPermission(
  role: AccessRole,
  permissions: readonly OfficerPermissionCode[],
  section: NavSection,
) {
  const required = section.permissions ?? []
  if (required.length === 0 || role === 'master' || role === 'admin') {
    return true
  }
  return section.permissionMode === 'any'
    ? required.some((permission) => permissions.includes(permission))
    : required.every((permission) => permissions.includes(permission))
}

export function findSectionByPath(path: string): NavSection | undefined {
  return (NAV_SECTIONS as readonly NavSection[]).find(
    (section) => path === section.path || path.startsWith(`${section.path}/`),
  )
}

/** Пути вне таблицы разделов (главная, кабинет) не ограничиваются. */
export function canAccessPath(
  role: AccessRole,
  path: string,
  permissions: readonly OfficerPermissionCode[] = [],
) {
  const section = findSectionByPath(path)
  return section
    ? hasRole(role, section.roles) &&
        hasSectionPermission(role, permissions, section)
    : true
}

/** Сумма счётчиков новизны разделов категории (или всех категорий). */
export function sumCounts(
  sections: readonly { id: string }[],
  counts: Partial<Record<string, number>> | undefined,
) {
  return sections.reduce(
    (total, section) => total + (counts?.[section.id] ?? 0),
    0,
  )
}
