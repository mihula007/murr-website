import { describe, expect, it } from 'vitest'
import {
  parseCallbackData,
  voteAnswerData,
  voteChangeData,
} from '../supabase/functions/_shared/messenger/callback-data.ts'
import { renderVoteMessage } from '../supabase/functions/_shared/messenger/vote-message.ts'

const voteId = '00000000-0000-4000-8000-000000000001'
const options = [
  { id: '00000000-0000-4000-8000-000000000002', label: 'За' },
  {
    id: '00000000-0000-4000-8000-000000000003',
    label: 'Большинство участников выберет этот путь',
  },
]
const announcement = { subject: 'Маршрут', body: 'Выберите направление.' }

describe('vote message rendering', () => {
  it('shows all full options and short labels while shortening long button labels', () => {
    const result = renderVoteMessage(announcement, options, null, false, 12)

    expect(result.text).toBe(
      'Маршрут\n\nВыберите направление.\n\nВарианты:\n1. За\n2. Большинство участников выберет этот путь',
    )
    expect(result.actions).toEqual([
      { label: 'За', data: 'v:00000000-0000-4000-8000-000000000002' },
      { label: '2. Большинс…', data: 'v:00000000-0000-4000-8000-000000000003' },
    ])
    expect(Array.from(result.actions[1]!.label).length).toBe(12)
  })

  it('shows the saved choice and only the change button after voting', () => {
    const result = renderVoteMessage(
      announcement,
      options,
      options[0]!.id,
      false,
      12,
    )

    expect(result.text).toContain('\n\nВаш голос: За')
    expect(result.actions).toEqual([{ label: 'Изменить решение', data: 'vc' }])
  })

  it('returns option buttons when the voter opens the change choice', () => {
    const result = renderVoteMessage(
      announcement,
      options,
      options[0]!.id,
      true,
      12,
    )

    expect(result.actions.map(({ label }) => label)).toEqual([
      'За',
      '2. Большинс…',
    ])
  })
})

describe('vote callback data', () => {
  it('round-trips a short answer without embedding the vote or user ID', () => {
    const data = voteAnswerData(options[0]!.id)

    expect(data).toBe('v:00000000-0000-4000-8000-000000000002')
    expect(data.length).toBeLessThan(64)
    expect(parseCallbackData(data)).toEqual({
      kind: 'vote-answer',
      optionId: options[0]!.id,
    })
  })

  it('parses a change action and rejects malformed option IDs', () => {
    expect(voteChangeData()).toBe('vc')
    expect(parseCallbackData('vc')).toEqual({ kind: 'vote-change' })
    expect(parseCallbackData('v:not-a-uuid')).toBeNull()
  })

  it('keeps existing event callback data readable', () => {
    expect(parseCallbackData(`a:${voteId}:y`)).toEqual({
      kind: 'answer',
      eventId: voteId,
      answer: 'yes',
    })
  })
})
