import { describe, expect, it } from 'vitest'
import { ACCESS_ROLES, type AccessRole } from '@/app/access'
import {
  NAV_SECTIONS,
  canAccessPath,
  visibleNavigation,
} from '@/app/navigation'

const MEMBER_SECTIONS = [
  'events',
  'votes',
  'roster',
  'publications',
  'market',
  'rating',
]
const FORGE_SECTIONS = [
  'gods',
  'rings',
  'robe',
  'equipment',
  'night-weapon',
  'chienkun',
  'titles',
]
const OFFICER_SECTIONS = [...MEMBER_SECTIONS, ...FORGE_SECTIONS]

const expected: Record<AccessRole, string[]> = {
  guest: [],
  applicant: [],
  reader: [],
  member: [...MEMBER_SECTIONS, ...FORGE_SECTIONS],
  officer: OFFICER_SECTIONS,
  master: [
    ...MEMBER_SECTIONS,
    'applications',
    'activity',
    'broadcast',
    'permissions',
    ...FORGE_SECTIONS,
  ],
  admin: [
    ...MEMBER_SECTIONS,
    'applications',
    'activity',
    'broadcast',
    'permissions',
    'admin',
    ...FORGE_SECTIONS,
  ],
}

function visibleIds(role: AccessRole) {
  return visibleNavigation(role, []).flatMap((category) =>
    category.sections.map((section) => section.id),
  )
}

describe('visibleNavigation', () => {
  it.each(ACCESS_ROLES)('показывает роли %s разделы по ACL', (role) => {
    expect(visibleIds(role)).toEqual(expected[role])
  })

  it('не возвращает пустых категорий (HOM-01)', () => {
    for (const role of ACCESS_ROLES) {
      for (const category of visibleNavigation(role)) {
        expect(category.sections.length).toBeGreaterThan(0)
      }
    }
  })

  it('группирует разделы по категориям HOM-02', () => {
    expect(visibleNavigation('guest')).toEqual([])
    expect(visibleNavigation('member').map((c) => c.label)).toEqual([
      'Клан',
      'Сообщество',
      'Кузня',
    ])
    const officer = visibleNavigation('officer', [
      'applications.review',
      'activity.view_export',
      'broadcasts.send',
    ])
    expect(officer.map((c) => c.label)).toEqual([
      'Клан',
      'Сообщество',
      'Управление',
      'Кузня',
    ])
    expect(officer[2]?.sections.map((s) => s.label)).toEqual([
      'Заявки',
      'Учёт активности',
      'Рассылка',
    ])
    expect(
      visibleNavigation('admin', [])[2]?.sections.map((s) => s.label),
    ).toContain('Администрирование')
    expect(
      visibleNavigation('master', [])[2]?.sections.map((s) => s.label),
    ).toContain('Мастерка')
  })
})

describe('canAccessPath', () => {
  it('разрешает разделы только перечисленным ролям', () => {
    expect(canAccessPath('guest', '/votes')).toBe(false)
    expect(canAccessPath('reader', '/events')).toBe(false)
    expect(canAccessPath('member', '/votes')).toBe(true)
    expect(canAccessPath('member', '/admin')).toBe(false)
    expect(canAccessPath('officer', '/applications', [])).toBe(false)
    expect(
      canAccessPath('officer', '/applications', ['applications.review']),
    ).toBe(true)
    expect(canAccessPath('officer', '/admin')).toBe(false)
    expect(canAccessPath('master', '/applications', [])).toBe(true)
    expect(canAccessPath('master', '/admin')).toBe(false)
    expect(canAccessPath('admin', '/admin')).toBe(true)
  })

  it('не ограничивает пути вне конфигурации разделов', () => {
    expect(canAccessPath('guest', '/')).toBe(true)
    expect(canAccessPath('guest', '/account')).toBe(true)
  })
})

describe('конфигурация разделов', () => {
  it('пути уникальны и начинаются с /', () => {
    const paths = NAV_SECTIONS.map((section) => section.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true)
    }
  })

  it('id разделов уникальны', () => {
    const ids = NAV_SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('категория Кузня', () => {
  it('показывает семь разделов внутренним ролям и скрывает от остальных', () => {
    expect(
      visibleNavigation('member')
        .find((x) => x.id === 'forge')
        ?.sections.map((x) => x.label),
    ).toEqual([
      'Боги',
      'Кольца',
      'Плащ',
      'Эквип',
      'Пуха',
      'Мирозданки',
      'Жребия',
    ])
    for (const role of ['guest', 'applicant', 'reader'] as const) {
      expect(visibleNavigation(role).some((x) => x.id === 'forge')).toBe(false)
    }
  })
  it('закрывает прямые ссылки не внутренним ролям', () => {
    expect(canAccessPath('guest', '/forge/gods')).toBe(false)
    expect(canAccessPath('member', '/forge/gods')).toBe(true)
  })
})
