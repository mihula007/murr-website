import type { RosterMember } from '@contracts/roster'
import type { CharacterStatNumberField } from '@contracts/character-stats'

export type CharacterStatDirection = 'asc' | 'desc'

/** Человеко-читаемое число из рейтинга; пустое значение показывается тире. */
export function formatCharacterStat(
  field: CharacterStatNumberField,
  value: number | null | undefined,
) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  if ((field === 'hp' || field === 'bd') && Math.abs(value) >= 10_000) {
    return `${(Math.round(value / 100) / 10).toString().replace('.', ',')}к`
  }
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(
    value,
  )
}

/** Сортирует один показатель; пустые — после заполненных в любом направлении. */
export function sortCharacterStats(
  items: readonly RosterMember[],
  field: CharacterStatNumberField,
  direction: CharacterStatDirection,
) {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...items].sort((left, right) => {
    const a = left[field]
    const b = right[field]
    if (a == null && b == null) {
      return left.gameNickname.localeCompare(right.gameNickname, 'ru-RU')
    }
    if (a == null) {
      return 1
    }
    if (b == null) {
      return -1
    }
    return (
      (a - b) * multiplier ||
      left.gameNickname.localeCompare(right.gameNickname, 'ru-RU')
    )
  })
}

/** Фильтрует полный список состава по классу; null означает все классы. */
export function filterCharacterStats(
  items: readonly RosterMember[],
  classId: number | null,
) {
  return classId === null
    ? [...items]
    : items.filter((item) => item.classId === classId)
}
