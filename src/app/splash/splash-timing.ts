import { readStored, writeStored, type StorageArea } from '@/lib/storage'

/** Заставка закрывается сама через 10 секунд после загрузки страницы (HOM-12). */
export const AUTO_CLOSE_MS = 10_000
/** Активность свежее 10 минут пропускает повторную заставку. */
export const IDLE_LIMIT_MS = 600_000
/** Длительность затухания при закрытии. */
export const LEAVE_MS = 1_100
/** Метка активности обновляется не чаще раза в 15 секунд. */
export const ACTIVITY_WRITE_INTERVAL_MS = 15_000
export const ACTIVITY_KEY = 'murr-last-activity'

export function shouldShowSplash(now: number, lastActivity: number | null) {
  if (lastActivity === null || lastActivity > now) {
    return true
  }
  return now - lastActivity >= IDLE_LIMIT_MS
}

/** Основное хранилище — localStorage, запасное — sessionStorage. */
const AREAS: readonly StorageArea[] = ['local', 'session']

export function readLastActivity(): number | null {
  const raw = readStored(ACTIVITY_KEY, AREAS)
  if (raw === null) {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function writeLastActivity(now: number) {
  writeStored(ACTIVITY_KEY, String(now), AREAS)
}
