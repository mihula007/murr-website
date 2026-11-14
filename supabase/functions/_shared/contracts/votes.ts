import { z } from 'zod'
import { pageRequestShape, type Page } from './paging.ts'

/** Ограничения голосований (VOT-02, VOT-03). */
export const VOTE_LIMITS = {
  title: 120,
  context: 1000,
  option: 80,
  optionsMin: 2,
  optionsMax: 10,
} as const

/** Фиксированные варианты голосования по заявке (APP-05, VOT-04). */
export const APPLICATION_VOTE_OPTIONS = [
  'За',
  'Против',
  'Воздержаться',
  'Конфликт',
] as const

export const VOTE_TABS = ['active', 'history'] as const
export type VoteTab = (typeof VOTE_TABS)[number]

export type VoteKind = 'general' | 'application'

/** Ключ сравнения вариантов: без учёта регистра после trim (VOT-03). */
export function normalizeOptionLabel(label: string) {
  return label.trim().toLocaleLowerCase('ru')
}

const titleSchema = z
  .string()
  .trim()
  .min(1, 'required')
  .max(VOTE_LIMITS.title, 'too_long')

const contextSchema = z
  .string()
  .trim()
  .max(VOTE_LIMITS.context, 'too_long')
  .nullish()
  .transform((value) => value ?? '')

const optionSchema = z
  .string()
  .trim()
  .min(1, 'required')
  .max(VOTE_LIMITS.option, 'too_long')

/**
 * Варианты: 2–10 заполненных и различных без учёта регистра. Повтор
 * помечается у второго из совпавших вариантов (`options.<i>`).
 */
export const voteOptionsSchema = z
  .array(optionSchema, 'required')
  .min(VOTE_LIMITS.optionsMin, 'too_few')
  .max(VOTE_LIMITS.optionsMax, 'too_many')
  .superRefine((options, context) => {
    const seen = new Set<string>()
    options.forEach((option, index) => {
      const key = normalizeOptionLabel(option)
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          message: 'duplicate',
          path: [index],
        })
      }
      seen.add(key)
    })
  })

export const createVoteSchema = z.object({
  title: titleSchema,
  context: contextSchema,
  options: voteOptionsSchema,
})
export type CreateVoteRequest = z.input<typeof createVoteSchema>

export const updateVoteSchema = z.object({
  id: z.guid('not_found'),
  title: titleSchema,
  context: contextSchema,
})
export type UpdateVoteRequest = z.input<typeof updateVoteSchema>

export const voteIdSchema = z.object({ id: z.guid('not_found') })

export const closeVoteSchema = voteIdSchema.extend({
  decision: z.enum(['accept', 'reject']).optional(),
})
export type CloseVoteRequest = z.input<typeof closeVoteSchema>

export const castBallotSchema = z.object({
  voteId: z.guid('not_found'),
  optionId: z.guid('not_found'),
})
export type CastBallotRequest = z.input<typeof castBallotSchema>

/**
 * «Актуальные» — малый список (≤ 50 по ответу владельца), отдаётся целиком.
 * «История» — большой, страницы по курсору `(closed_at, id)`.
 */
export const listVotesSchema = z.object({
  tab: z.enum(VOTE_TABS),
  ...pageRequestShape,
})
export type ListVotesRequest = z.input<typeof listVotesSchema>

export type VoteOptionResult = {
  id: string
  label: string
  count: number
  /** Вариант с наибольшим числом голосов больше нуля; при равенстве — все. */
  leading: boolean
}

/** О кандидате в голосовании по заявке — только ник и класс (VOT-04). */
export type VoteApplicant = { gameNickname: string; className: string }

export type VoteSummary = {
  id: string
  kind: VoteKind
  title: string
  context: string
  createdAt: string
  closedAt: string | null
  /** Ник создателя; null — пользователь удалён (VOT-15). */
  createdBy: { gameNickname: string } | null
  applicant: VoteApplicant | null
  options: VoteOptionResult[]
  totalBallots: number
  /** Вариант текущего пользователя; null — не голосовал. */
  myOptionId: string | null
  /** Сообщений в обсуждении (VOT-13, DSC-01). */
  messageCount?: number
}

/** Голос для офицера и администратора (Q-16); null ник — удалённый участник. */
export type VoteBallotView = {
  gameNickname: string | null
  optionId: string
}

export type VoteDetails = VoteSummary & {
  /** Только офицеру и администратору (VOT-07); членам поля нет. */
  ballots?: VoteBallotView[]
  /** Голосов больше порога малого списка: показана часть. */
  ballotsTruncated?: boolean
  /** Связанная заявка — только офицеру и администратору. */
  applicationId?: string
}

export type VoteListResponse = Page<VoteSummary> & {
  activeCount: number
  /** «Актуальные»: голосований больше порога, показаны новые. */
  truncated: boolean
}
