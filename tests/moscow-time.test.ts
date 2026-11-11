// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import {
  moscowToUtc,
  nextOccurrence,
  parseTimestamp,
  utcToMoscow,
  weekdayOf,
} from '@contracts/moscow-time'

const originalTz = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTz
})

describe('Moscow time (Q-08, Q-44)', () => {
  it('converts Moscow date and time to UTC across the day boundary', () => {
    expect(moscowToUtc('2026-11-14', '23:30').toISOString()).toBe(
      '2026-11-14T20:30:00.000Z',
    )
    expect(moscowToUtc('2026-11-14', '01:00').toISOString()).toBe(
      '2026-11-13T22:00:00.000Z',
    )
  })

  it('converts UTC back to Moscow date, time and weekday', () => {
    expect(utcToMoscow('2026-11-13T22:00:00.000Z')).toEqual({
      date: '2026-11-14',
      time: '01:00',
      weekday: 6,
    })
  })

  it('reads Postgres timestamps', () => {
    expect(parseTimestamp('2026-11-14 17:00:00+00').toISOString()).toBe(
      '2026-11-14T17:00:00.000Z',
    )
    expect(parseTimestamp('2026-11-14 20:00:00.5+03').toISOString()).toBe(
      '2026-11-14T17:00:00.500Z',
    )
  })

  it('gives the weekday of a calendar date', () => {
    expect(weekdayOf('2026-11-14')).toBe(6)
    expect(weekdayOf('2026-11-15')).toBe(0)
  })

  it('creates this weekend on Monday 00:00 Moscow time (Q-42)', () => {
    // Понедельник 16.11.2026 00:00 МСК = воскресенье 21:00 UTC.
    const monday = new Date('2026-11-15T21:00:00.000Z')
    expect(utcToMoscow(nextOccurrence(monday, 6, '20:00'))).toMatchObject({
      date: '2026-11-21',
      time: '20:00',
    })
    expect(utcToMoscow(nextOccurrence(monday, 0, '22:00'))).toMatchObject({
      date: '2026-11-22',
      time: '22:00',
    })
  })

  it('moves to next week when the time today has come (EVT-12)', () => {
    const sundayAt22 = moscowToUtc('2026-11-15', '22:00')
    expect(utcToMoscow(nextOccurrence(sundayAt22, 0, '22:00')).date).toBe(
      '2026-11-22',
    )
    const sundayBefore = moscowToUtc('2026-11-15', '21:59')
    expect(utcToMoscow(nextOccurrence(sundayBefore, 0, '22:00')).date).toBe(
      '2026-11-15',
    )
    const sundayAfter = moscowToUtc('2026-11-15', '22:01')
    expect(utcToMoscow(nextOccurrence(sundayAfter, 0, '22:00')).date).toBe(
      '2026-11-22',
    )
  })

  it.each(['America/New_York', 'Asia/Vladivostok', 'Europe/Berlin'])(
    'does not depend on the process time zone %s, including DST dates',
    (zone) => {
      process.env.TZ = zone
      // 29.03.2026 — переход Европы на летнее время.
      expect(moscowToUtc('2026-03-29', '02:30').toISOString()).toBe(
        '2026-03-28T23:30:00.000Z',
      )
      expect(utcToMoscow('2026-03-28T23:30:00.000Z')).toEqual({
        date: '2026-03-29',
        time: '02:30',
        weekday: 0,
      })
      const now = moscowToUtc('2026-03-26', '12:00')
      expect(utcToMoscow(nextOccurrence(now, 6, '20:00'))).toMatchObject({
        date: '2026-03-28',
        time: '20:00',
      })
    },
  )
})
