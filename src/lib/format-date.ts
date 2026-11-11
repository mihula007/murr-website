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
