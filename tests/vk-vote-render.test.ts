import { describe, expect, it } from 'vitest'
import {
  voteAnswerData,
  voteChangeData,
} from '../supabase/functions/_shared/messenger/callback-data.ts'
import { vkVoteMessage } from '../supabase/functions/_shared/vk/render.ts'

describe('vkVoteMessage', () => {
  const announcement = { subject: 'Маршрут', body: 'Выберите ответ' }
  const options = [
    { id: 'one', label: 'За' },
    { id: 'two', label: 'Большинство участников выберет этот путь' },
  ]

  it('shows full short labels and numbered prefixes for long labels', () => {
    const message = vkVoteMessage(announcement, options, null)
    expect(message.text).toContain(
      '2. Большинство участников выберет этот путь',
    )
    expect(
      message.keyboard.flat().map((button) => button.action.label),
    ).toEqual(['За', expect.stringMatching(/^2\. Большин/)])
    expect(
      message.keyboard
        .flat()
        .map((button) => JSON.parse(button.action.payload)),
    ).toEqual([{ d: voteAnswerData('one') }, { d: voteAnswerData('two') }])
  })

  it('shows the selected vote and the change button', () => {
    expect(vkVoteMessage(announcement, options, 'two')).toEqual({
      text: expect.stringContaining(
        'Ваш голос: Большинство участников выберет этот путь',
      ),
      keyboard: [
        [
          {
            action: {
              type: 'callback',
              label: 'Изменить решение',
              payload: JSON.stringify({ d: voteChangeData() }),
            },
          },
        ],
      ],
    })
  })
})
