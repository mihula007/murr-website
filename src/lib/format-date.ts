import { WEEKDAY_LABELS } from '@contracts/events'
import { utcToMoscow } from '@contracts/moscow-time'

/**
 * Единственное форматирование дат в интерфейсе: `ДД.ММ.ГГГГ` из ISO-даты
 * или метки времени (`2026-11-08`, `2026-11-08T10:00:00Z`). Без значения — «—».
 * Берётся календарная дата из строки, без перевода в часовой пояс браузера.
 */
export function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—'
  }
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

/**
 * Дата и время события по Москве (Q-08, Q-44): `ДД.ММ.ГГГГ, ЧЧ:ММ МСК`.
 * Перевод — общий модуль `@contracts/moscow-time`, пояс браузера не влияет.
 */
export function formatDateTimeMsk(iso: string) {
  const msk = utcToMoscow(iso)
  return `${formatDate(msk.date)}, ${msk.time} МСК`
}

/** Время по Москве `ЧЧ:ММ` — подпись сообщения обсуждения. */
export function formatTimeMsk(iso: string) {
  return utcToMoscow(iso).time
}

/**
 * Дата метки времени по Москве `ДД.ММ.ГГГГ` (создание, подача, решение,
 * закрытие; разделитель дней в обсуждении, DSC-02). `formatDate` для меток
 * времени не подходит: между 00:00 и 03:00 МСК дата в UTC — ещё вчерашняя.
 */
export function formatDateMsk(iso: string | null | undefined) {
  return iso ? formatDate(utcToMoscow(iso).date) : '—'
}

/** День недели и время по Москве: `суббота, 20:00 МСК`. */
export function formatWeekdayTimeMsk(weekday: number, time: string) {
  return `${WEEKDAY_LABELS[weekday] ?? ''}, ${time} МСК`
}

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]

/** Месяц `ГГГГ-ММ` словами: `ноябрь 2026` (топ-5 месяца на главной). */
export function formatMonth(month: string) {
  const [year, number] = month.split('-')
  const name = MONTH_NAMES[Number(number) - 1]
  return name ? `${name} ${year}` : month
}
