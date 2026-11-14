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

const MONTH_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

/**
 * Начало события по Москве словами для заголовка (EVT-06):
 * `{ day: 'Суббота, 14 ноября 2026', time: '20:00 МСК' }`. С `now` сегодняшний
 * и завтрашний по Москве день называются словом: `Сегодня, 14 ноября`.
 */
export function formatEventStartMsk(iso: string, now?: Date) {
  const msk = utcToMoscow(iso)
  const [year, month, day] = msk.date.split('-')
  const date = `${Number(day)} ${MONTH_GENITIVE[Number(month) - 1] ?? ''}`
  let relative: string | null = null
  if (now) {
    const today = utcToMoscow(now).date
    const tomorrow = utcToMoscow(
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    ).date
    relative =
      msk.date === today ? 'Сегодня' : msk.date === tomorrow ? 'Завтра' : null
  }
  const weekday = WEEKDAY_LABELS[msk.weekday] ?? ''
  return {
    day: relative
      ? `${relative}, ${date}`
      : `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${date} ${year}`,
    time: `${msk.time} МСК`,
  }
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
