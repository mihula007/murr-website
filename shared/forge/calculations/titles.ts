import { TITLE_DEFINITIONS } from '../title-definitions.ts'
import { TITLE_GROUPS } from '../title-groups.ts'

export type TitlesInput = {
  checkedLevels: Readonly<Record<number, number>>
  priorities?: readonly string[]
  method?: 'full' | 'priority'
}
export type TitlesEstimate = {
  optimistic: number
  average: number
  conservative: number
  levelsRemaining: number
}
export type TitleStat = {
  stat: string
  current: number
  maximum: number
  remaining: number
}
export const TITLE_STAT_BONUS: Readonly<Record<string, number>> = {
  hp: 100,
  pa: 1,
  pz: 1,
  patk: 50,
  matk: 50,
  pdef: 200,
  mdef: 200,
}

export function calculateTitleStats(
  checkedLevels: Readonly<Record<number, number>>,
): TitleStat[] {
  const counts: Record<string, number> = Object.fromEntries(
    Object.keys(TITLE_STAT_BONUS).map((stat) => [stat, 0]),
  )
  for (const title of TITLE_DEFINITIONS) {
    const completed = clampLevel(checkedLevels[title.id] ?? 0)
    for (const stat of title.stats.slice(0, completed)) {
      counts[stat] = (counts[stat] ?? 0) + 1
    }
  }
  const maximumCounts: Record<string, number> = Object.fromEntries(
    Object.keys(TITLE_STAT_BONUS).map((stat) => [stat, 0]),
  )
  for (const title of TITLE_DEFINITIONS) {
    for (const stat of title.stats) {
      maximumCounts[stat] = (maximumCounts[stat] ?? 0) + 1
    }
  }
  return Object.entries(TITLE_STAT_BONUS).map(([stat, bonus]) => ({
    stat,
    current: (counts[stat] ?? 0) * bonus,
    maximum: (maximumCounts[stat] ?? 0) * bonus,
    remaining: ((maximumCounts[stat] ?? 0) - (counts[stat] ?? 0)) * bonus,
  }))
}

const clampLevel = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(7, Math.trunc(value))) : 0

/** Вероятностная модель исходного калькулятора: попытки на пару титулов. */
export function estimateTitles(input: TitlesInput): TitlesEstimate {
  const current = TITLE_DEFINITIONS.map((title) =>
    clampLevel(input.checkedLevels[title.id] ?? 0),
  )
  const priorities = new Set(input.priorities ?? [])
  const target = TITLE_DEFINITIONS.map((title) => {
    if (input.method !== 'priority') {
      return 7
    }
    let lastPriorityLevel = 0
    title.stats.forEach((stat, index) => {
      if (priorities.has(stat)) {
        lastPriorityLevel = index + 1
      }
    })
    return lastPriorityLevel
  })
  const remaining = current.reduce(
    (sum, level, index) => sum + Math.max(0, target[index]! - level),
    0,
  )
  if (remaining === 0) {
    return { optimistic: 0, average: 0, conservative: 0, levelsRemaining: 0 }
  }

  const expected = Array.from({ length: 8 }, () => Array<number>(8).fill(0))
  const attempts = Array.from({ length: 8 }, () => Array<number>(8).fill(0))
  for (let level = 1; level <= 7; level++) {
    expected[level]![0] = 2 * level
    expected[0]![level] = 2 * level
    attempts[level]![0] = level
    attempts[0]![level] = level
  }
  for (let left = 1; left <= 7; left++) {
    for (let right = 1; right <= 7; right++) {
      expected[left]![right] =
        1 +
        0.5 * expected[left - 1]![right]! +
        0.5 * expected[left]![right - 1]!
      attempts[left]![right] =
        0.5 * attempts[left - 1]![right]! + 0.5 * attempts[left]![right - 1]!
    }
  }

  let expectedPairs = 0
  let attemptsPairs = 0
  for (const group of TITLE_GROUPS) {
    const first = TITLE_DEFINITIONS.findIndex(
      (title) => title.id === group.items[0],
    )
    const second = TITLE_DEFINITIONS.findIndex(
      (title) => title.id === group.items[1],
    )
    if (first < 0 || second < 0) {
      continue
    }
    const left = Math.max(0, target[first]! - current[first]!)
    const right = Math.max(0, target[second]! - current[second]!)
    expectedPairs += expected[left]![right]!
    attemptsPairs += attempts[left]![right]!
  }
  const average = Math.max(
    0,
    Math.round(expectedPairs / (0.0224 * 0.8) - 5 * attemptsPairs),
  )
  return {
    optimistic: Math.max(0, Math.round(0.9 * average)),
    average,
    conservative: Math.max(0, Math.round(1.1 * average)),
    levelsRemaining: remaining,
  }
}
