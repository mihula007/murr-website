import { describe, expect, it } from 'vitest'
import {
  voteAnswerData,
  voteChangeData,
} from '../supabase/functions/_shared/messenger/callback-data.ts'
import { maxVoteMessage } from '../supabase/functions/_shared/max/render.ts'

const options = [
  { id: '00000000-0000-4000-8000-000000000001', label: 'За' },
  {
    id: '00000000-0000-4000-8000-000000000002',
    label: 'Большинство участников выберет этот путь',
  },
  { id: '00000000-0000-4000-8000-000000000003', label: 'Против' },
]

describe('MAX vote message rendering', () => {
  it('maps generic actions to MAX callback buttons and keeps full options in text', () => {
    const result = maxVoteMessage(
      { subject: 'Маршрут', body: 'Выберите направление.' },
      options,
      null,
    )

    expect(result.html).toContain('2. Большинство участников выберет этот путь')
    expect(result.html).toMatch(/^<b>Маршрут<\/b>/)
    expect(result.keyboard).toEqual([
      [
        {
          type: 'callback',
          text: 'За',
          payload: voteAnswerData(options[0]!.id),
        },
      ],
      [
        {
          type: 'callback',
          text: '2. Большинство учас…',
          payload: voteAnswerData(options[1]!.id),
        },
      ],
      [
        {
          type: 'callback',
          text: 'Против',
          payload: voteAnswerData(options[2]!.id),
        },
      ],
    ])
    expect(
      result.keyboard.flat().every((button) => button.text.length <= 20),
    ).toBe(true)
  })

  it('shows the current choice with a change action', () => {
    const result = maxVoteMessage(
      { subject: null, body: 'Опрос' },
      options,
      options[1]!.id,
    )

    expect(result.html).toContain(
      'Ваш голос: Большинство участников выберет этот путь',
    )
    expect(result.keyboard).toEqual([
      [
        {
          type: 'callback',
          text: 'Изменить решение',
          payload: voteChangeData(),
        },
      ],
    ])
  })
})
