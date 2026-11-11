/**
 * Московское время (Q-08, Q-44): фиксированное UTC+3 без перехода на летнее
 * время. Единственное место перевода МСК ↔ UTC; используется сервером и
 * клиентом, поэтому результат не зависит от часового пояса браузера.
 */
const OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type MoscowDateTime = {
  /** `YYYY-MM-DD` */
  date: string
  /** `HH:MM` */
  time: string
  /** 0 — воскресенье … 6 — суббота */
  weekday: number
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Метка времени из Postgres (`2026-11-14 17:00:00+00`) или ISO → `Date`. */
export function parseTimestamp(value: string): Date {
  let iso = value.trim().replace(' ', 'T')
  if (/[+-]\d\d$/.test(iso)) {
    iso += ':00'
  }
  return new Date(iso)
}

/** Дата и время МСК → момент UTC. */
export function moscowToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(
    Date.UTC(year!, month! - 1, day!, hours!, minutes!) - OFFSET_MS,
  )
}

/** Момент → дата, время и день недели по МСК. */
export function utcToMoscow(moment: Date | string): MoscowDateTime {
  const at = typeof moment === 'string' ? parseTimestamp(moment) : moment
  const shifted = new Date(at.getTime() + OFFSET_MS)
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    weekday: shifted.getUTCDay(),
  }
}

/** День недели календарной даты (`YYYY-MM-DD`), 0 — воскресенье. */
export function weekdayOf(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
}

/**
 * Ближайший будущий момент с днём недели и временем МСК (EVT-12, EVT-14).
 * Если сегодня нужный день, но время уже наступило, — через неделю.
 */
export function nextOccurrence(now: Date, weekday: number, time: string): Date {
  const today = utcToMoscow(now)
  const ahead = (weekday - today.weekday + 7) % 7
  const base = moscowToUtc(today.date, time)
  let candidate = new Date(base.getTime() + ahead * DAY_MS)
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(candidate.getTime() + 7 * DAY_MS)
  }
  return candidate
}
