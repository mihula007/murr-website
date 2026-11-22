import { announcementPlain, type AnnouncementText } from './announcement.ts'
import { voteAnswerData, voteChangeData } from './callback-data.ts'

export type VoteMessageOption = { id: string; label: string }
export type VoteMessageAction = { label: string; data: string }

export type VoteMessage = {
  text: string
  actions: VoteMessageAction[]
}

function buttonLabel(label: string, position: number, limit: number) {
  const characters = Array.from(label)
  if (characters.length <= limit) {
    return label
  }

  const prefix = `${position}. `
  const prefixLength = Array.from(prefix).length
  const available = Math.max(0, limit - prefixLength)
  if (available === 0) {
    return Array.from(prefix).slice(0, limit).join('')
  }
  return `${prefix}${characters.slice(0, available - 1).join('')}…`
}

/** Общий текст и нейтральные действия для кнопок Telegram, MAX и ВКонтакте. */
export function renderVoteMessage(
  announcement: AnnouncementText,
  options: readonly VoteMessageOption[],
  selectedOptionId: string | null,
  choosing: boolean,
  labelLimit: number,
): VoteMessage {
  const selected = options.find((option) => option.id === selectedOptionId)
  const optionText = options
    .map((option, index) => `${index + 1}. ${option.label}`)
    .join('\n')
  const text = [
    announcementPlain(announcement),
    `Варианты:\n${optionText}`,
    selected ? `Ваш голос: ${selected.label}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n')

  const actions =
    selected && !choosing
      ? [{ label: 'Изменить решение', data: voteChangeData() }]
      : options.map((option, index) => ({
          label: buttonLabel(option.label, index + 1, labelLimit),
          data: voteAnswerData(option.id),
        }))

  return { text, actions }
}
