import { z } from 'zod'

export const CHARACTER_STAT_FIELDS = ['pa', 'pz', 'bu', 'hp', 'bd'] as const
export type CharacterStatNumberField = (typeof CHARACTER_STAT_FIELDS)[number]
export type CharacterStatField = CharacterStatNumberField | 'source'

export const CHARACTER_STAT_LABELS: Record<CharacterStatField, string> = {
  pa: 'ПА',
  pz: 'ПЗ',
  bu: 'БУ',
  hp: 'ХП',
  bd: 'БД',
  source: 'Источник',
}

/** Добавочные поля карточек остаются необязательными при выкладке клиента. */
export type CharacterStatFields = {
  pa?: number | null
  pz?: number | null
  bu?: number | null
  hp?: number | null
  bd?: number | null
  characterStatsSource?: string | null
}

// numeric(18,3) хранит не более 18 цифр, считая три знака после запятой.
const MAX_THOUSANDTHS = 999_999_999_999_999_999n
const NUMBER_PATTERN = /^(\d+)(?:[.,](\d{1,3}))?([кК])?$/

function parseNumberValue(value: string): number | undefined {
  const match = NUMBER_PATTERN.exec(value)
  if (!match) {
    return undefined
  }
  const whole = BigInt(match[1]!)
  const fraction = BigInt((match[2] ?? '').padEnd(3, '0') || '0')
  const thousandths = (whole * 1000n + fraction) * (match[3] ? 1000n : 1n)
  if (thousandths > MAX_THOUSANDTHS) {
    return undefined
  }
  return Number(thousandths) / 1000
}

const numericValueSchema = z
  .string()
  .trim()
  .max(64, 'too_long')
  .nullable()
  .transform((value, context) => {
    if (value === null || value === '') {
      return null
    }
    const parsed = parseNumberValue(value)
    if (parsed === undefined) {
      context.addIssue({ code: 'custom', message: 'invalid_number' })
      return z.NEVER
    }
    return parsed
  })

const sourceValueSchema = z
  .string()
  .trim()
  .max(160, 'too_long')
  .nullable()
  .transform((value) => value || null)

const userIdSchema = z.guid('not_found')

export const setCharacterStatSchema = z.discriminatedUnion('field', [
  z.object({
    userId: userIdSchema,
    field: z.enum(CHARACTER_STAT_FIELDS),
    value: numericValueSchema,
  }),
  z.object({
    userId: userIdSchema,
    field: z.literal('source'),
    value: sourceValueSchema,
  }),
])

export type SetCharacterStatRequest = z.input<typeof setCharacterStatSchema>
export type SetCharacterStatCommand = z.output<typeof setCharacterStatSchema>
export type SetCharacterStatResult = {
  userId: string
  field: CharacterStatField
  value: number | string | null
}
