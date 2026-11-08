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
  if (lastActivity === null || lastActivity > now) return true
  return now - lastActivity >= IDLE_LIMIT_MS
}

function storages() {
  const result: Storage[] = []
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      result.push(window[name])
    } catch {
      // Хранилище запрещено настройками браузера.
    }
  }
  return result
}

export function readLastActivity(): number | null {
  for (const storage of storages()) {
    try {
      const raw = storage.getItem(ACTIVITY_KEY)
      if (raw === null) continue
      const value = Number(raw)
      if (Number.isFinite(value)) return value
    } catch {
      // Пробуем следующее хранилище.
    }
  }
  return null
}

export function writeLastActivity(now: number) {
  for (const storage of storages()) {
    try {
      storage.setItem(ACTIVITY_KEY, String(now))
      return
    } catch {
      // Пробуем следующее хранилище.
    }
  }
}
