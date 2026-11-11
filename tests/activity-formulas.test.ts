import { describe, expect, it } from 'vitest'
import {
  attendancePercent,
  compareAttendance,
  daysInGuild,
} from '@contracts/activity'

describe('attendancePercent (ACT-05, Q-49)', () => {
  it('rounds to a whole number', () => {
    expect(attendancePercent(1, 3)).toBe(33)
    expect(attendancePercent(2, 3)).toBe(67)
    expect(attendancePercent(1, 2)).toBe(50)
    expect(attendancePercent(3, 3)).toBe(100)
  })

  it('is 0 without records instead of dividing by zero', () => {
    expect(attendancePercent(0, 0)).toBe(0)
  })
})

describe('daysInGuild (ACT-15)', () => {
  it('counts full days from the joining date to today in Moscow', () => {
    expect(daysInGuild('2026-11-12', '2026-11-12')).toBe(0)
    expect(daysInGuild('2026-11-11', '2026-11-12')).toBe(1)
    expect(daysInGuild('2025-11-12', '2026-11-12')).toBe(365)
    // Через границу месяца и високосный февраль.
    expect(daysInGuild('2028-02-28', '2028-03-01')).toBe(2)
  })

  it('is unknown without a date or with a future date', () => {
    expect(daysInGuild(null, '2026-11-12')).toBeNull()
    expect(daysInGuild('2026-11-13', '2026-11-12')).toBeNull()
  })
})

describe('compareAttendance (ACT-12)', () => {
  it('orders by visits, then percent, then nickname; unknown percent last', () => {
    const rows = [
      { gameNickname: 'Яна', visited: 2, percent: 50 },
      { gameNickname: 'Борис', visited: 2, percent: 100 },
      { gameNickname: 'Анна', visited: 2, percent: 50 },
      { gameNickname: 'Ёж', visited: 0, percent: null },
      { gameNickname: 'Вера', visited: 0, percent: 0 },
      { gameNickname: 'Глеб', visited: 3, percent: 30 },
    ]
    expect(rows.sort(compareAttendance).map((row) => row.gameNickname)).toEqual(
      ['Глеб', 'Борис', 'Анна', 'Яна', 'Вера', 'Ёж'],
    )
  })
})
