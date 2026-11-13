/** Форма слова по числу: `[один, несколько, много]` — «1 участник, 2 участника, 5 участников». */
export function pluralRu(
  count: number,
  [one, few, many]: [string, string, string],
) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return one
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few
  }
  return many
}

/** «участник / участника / участников». */
export function membersLabel(count: number) {
  return pluralRu(count, ['участник', 'участника', 'участников'])
}

/** «голосование идёт / голосования идут / голосований идут». */
export function activeVotesLabel(count: number) {
  return pluralRu(count, [
    'голосование идёт',
    'голосования идут',
    'голосований идут',
  ])
}

/** «ивент скоро / ивента скоро / ивентов скоро». */
export function eventsLabel(count: number) {
  return pluralRu(count, ['ивент скоро', 'ивента скоро', 'ивентов скоро'])
}
