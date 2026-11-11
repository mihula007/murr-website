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
const OFFICER_SECTIONS = [
  ...MEMBER_SECTIONS,
  'applications',
  'activity',
  'broadcast',
]

const expected: Record<AccessRole, string[]> = {
  guest: [],
  applicant: [],
  reader: [],
  member: MEMBER_SECTIONS,
  officer: OFFICER_SECTIONS,
  admin: [...OFFICER_SECTIONS, 'admin'],
}

function visibleIds(role: AccessRole) {
  return visibleNavigation(role).flatMap((category) =>
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
    ])
    const officer = visibleNavigation('officer')
    expect(officer.map((c) => c.label)).toEqual([
      'Клан',
      'Сообщество',
      'Управление',
    ])
    expect(officer[2]?.sections.map((s) => s.label)).toEqual([
      'Заявки',
      'Учёт активности',
      'Рассылка',
    ])
    expect(
      visibleNavigation('admin')[2]?.sections.map((s) => s.label),
    ).toContain('Администрирование')
  })
})

describe('canAccessPath', () => {
  it('разрешает разделы только перечисленным ролям', () => {
    expect(canAccessPath('guest', '/votes')).toBe(false)
    expect(canAccessPath('reader', '/events')).toBe(false)
    expect(canAccessPath('member', '/votes')).toBe(true)
    expect(canAccessPath('member', '/admin')).toBe(false)
    expect(canAccessPath('officer', '/applications')).toBe(true)
    expect(canAccessPath('officer', '/admin')).toBe(false)
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
