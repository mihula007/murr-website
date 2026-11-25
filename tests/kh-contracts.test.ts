import { describe, expect, it } from 'vitest'
import {
  KH_QUEUE_IDS,
  KH_QUEUE_LABELS,
  khQueueEntryActionSchema,
  khQueueKeySchema,
  khQueuesRequestSchema,
  khQueuesResponseSchema,
} from '../supabase/functions/_shared/contracts/kh.ts'

describe('KH queue contracts', () => {
  it('exposes the fourteen queues in the approved display order', () => {
    expect(KH_QUEUE_IDS).toEqual([
      'summons',
      'kh_hands',
      'scale_buyout',
      'highest_buyout',
      'highest',
      'meteorites',
      'uf_passes',
      'essence',
      'scale',
      'dobi_stones',
      's_cards',
      'kh_passes',
      'disc',
      'pet',
    ])
    expect(KH_QUEUE_IDS.map((id) => KH_QUEUE_LABELS[id])).toEqual([
      'призывы',
      'руки кх:',
      'чешуя выкуп:',
      'высший выкуп',
      'высший',
      'метеориты',
      'проходки уф',
      'сущность',
      'чешуя',
      'камни доблы',
      'карты s',
      'проходки кх',
      'диск',
      'пет',
    ])
  })

  it('rejects queue keys outside the fixed set', () => {
    expect(khQueueKeySchema.safeParse('pet').success).toBe(true)
    expect(khQueueKeySchema.safeParse('unknown').success).toBe(false)
  })

  it('accepts only positive PostgreSQL entry IDs for queue actions', () => {
    expect(
      khQueueEntryActionSchema.safeParse({
        queueKey: 'summons',
        entryId: '9223372036854775807',
      }).success,
    ).toBe(true)
    expect(
      khQueueEntryActionSchema.safeParse({
        queueKey: 'summons',
        entryId: '9223372036854775808',
      }).success,
    ).toBe(false)
  })

  it('accepts one independent cursor per queue and rejects unknown cursor keys', () => {
    expect(
      khQueuesRequestSchema.safeParse({
        cursors: { summons: 'eyJpZCI6IjIifQ', pet: 'eyJpZCI6IjMifQ' },
      }).success,
    ).toBe(true)
    expect(
      khQueuesRequestSchema.safeParse({ cursors: { summons: null } }).success,
    ).toBe(false)
    expect(
      khQueuesRequestSchema.safeParse({
        cursors: { unknown: 'eyJpZCI6IjIifQ' },
      }).success,
    ).toBe(false)
  })

  it('accepts fourteen independently paged queues with string IDs', () => {
    const emptyPage = { items: [], nextCursor: null }
    const queues = Object.fromEntries(KH_QUEUE_IDS.map((id) => [id, emptyPage]))
    const result = khQueuesResponseSchema.safeParse({ queues })
    expect(result.success).toBe(true)
    expect(
      khQueuesResponseSchema.safeParse({
        queues: {
          ...queues,
          summons: {
            items: [
              {
                id: '9007199254740993',
                userId: '00000000-0000-4000-8000-000000000001',
                gameNickname: 'СуперНик9',
                autoRejoin: false,
              },
            ],
            nextCursor: null,
          },
        },
      }).success,
    ).toBe(true)
    expect(
      khQueuesResponseSchema.safeParse({
        queues: { ...queues, summons: { items: [], nextCursor: '' } },
      }).success,
    ).toBe(false)
  })
})
