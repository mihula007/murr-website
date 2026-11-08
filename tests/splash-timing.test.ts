import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_KEY,
  IDLE_LIMIT_MS,
  readLastActivity,
  shouldShowSplash,
  writeLastActivity,
} from '@/app/splash/splash-timing'

const NOW = new Date('2026-11-08T12:00:00Z').getTime()
const MINUTE = 60_000

describe('shouldShowSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('показывает при первом открытии', () => {
    expect(shouldShowSplash(Date.now(), null)).toBe(true)
  })

  it('пропускает, если активность была 5 минут назад', () => {
    expect(shouldShowSplash(Date.now(), NOW - 5 * MINUTE)).toBe(false)
  })

  it('показывает, если активность была 11 минут назад', () => {
    expect(shouldShowSplash(Date.now(), NOW - 11 * MINUTE)).toBe(true)
  })

  it('показывает ровно на границе 10 минут', () => {
    expect(shouldShowSplash(Date.now(), NOW - IDLE_LIMIT_MS)).toBe(true)
  })

  it('показывает, если метка из будущего', () => {
    expect(shouldShowSplash(Date.now(), NOW + MINUTE)).toBe(true)
  })
})

describe('метка активности', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('записывает и читает метку', () => {
    writeLastActivity(NOW)
    expect(localStorage.getItem(ACTIVITY_KEY)).toBe(String(NOW))
    expect(readLastActivity()).toBe(NOW)
  })

  it('игнорирует повреждённое значение', () => {
    localStorage.setItem(ACTIVITY_KEY, 'не число')
    expect(readLastActivity()).toBeNull()
  })

  it('использует sessionStorage, если localStorage недоступен', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota')
    })
    writeLastActivity(NOW)
    expect(sessionStorage.getItem(ACTIVITY_KEY)).toBe(String(NOW))
    expect(readLastActivity()).toBe(NOW)
  })

  it('при недоступном хранилище показывает заставку без ошибки', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => writeLastActivity(NOW)).not.toThrow()
    expect(readLastActivity()).toBeNull()
    expect(shouldShowSplash(NOW, readLastActivity())).toBe(true)
  })
})
