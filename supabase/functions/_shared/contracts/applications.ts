import { z } from 'zod'
import {
  equipmentLinksSchema,
  LIMITS,
  type ApplicationStatus,
} from './account.ts'
import { pageRequestShape, type Page } from './paging.ts'
import type { VoteOptionResult } from './votes.ts'

/** Доступные очереди заявок. */
export const APPLICATION_TABS = ['new', 'decided'] as const
export type ApplicationTab = (typeof APPLICATION_TABS)[number]

/**
 * «Новые» — малый список (≤ 50), курсор не используется. «Решённые» —
 * большой, страницы по курсору.
 */
export const listApplicationsSchema = z.object({
  tab: z.enum(APPLICATION_TABS),
  ...pageRequestShape,
})
export type ListApplicationsRequest = z.input<typeof listApplicationsSchema>

export const applicationIdSchema = z.object({ id: z.guid('not_found') })

export const decideApplicationSchema = z.object({
  id: z.guid('not_found'),
  decision: z.enum(['accept', 'reject']),
  note: z
    .string()
    .trim()
    .max(LIMITS.decisionNote, 'too_long')
    .nullish()
    .transform((value) => value || null),
})
export type DecideApplicationRequest = z.input<typeof decideApplicationSchema>

export const resubmitApplicationSchema = z.object({
  equipmentLinks: equipmentLinksSchema,
})
export type ResubmitApplicationRequest = z.input<
  typeof resubmitApplicationSchema
>

/** Кандидат в списке: только ник, класс и аватар. */
export type ApplicantSummary = {
  id: string
  gameNickname: string
  classId: number
  className: string
  avatarUrl: string | null
}

/** Итоги связанного голосования (APP-08). */
export type ApplicationVoteResult = {
  id: string
  closedAt: string | null
  options: VoteOptionResult[]
  totalBallots: number
}

export type ApplicationListItem = {
  id: string
  status: ApplicationStatus
  submittedAt: string
  decidedAt: string | null
  applicant: ApplicantSummary
}

export type ApplicationListResponse = Page<ApplicationListItem> & {
  /** Число новых заявок для счётчика вкладки. */
  newCount: number
  /**
   * «Новые»: заявок больше порога малого списка, показаны самые старые.
   * Список не обрезается молча — интерфейс сообщает об этом.
   */
  truncated: boolean
}

/**
 * Карточка заявки. Офицеру — имя, ник, класс, аватар, рассказ и ссылки
 * (APP-03). Поле `contacts` есть только в ответе администратору.
 */
export type ApplicationDetails = {
  id: string
  status: ApplicationStatus
  submittedAt: string
  decidedAt: string | null
  decisionNote: string | null
  decidedBy: { gameNickname: string } | null
  equipmentLinks: string[]
  /** Последнее связанное голосование (APP-05, 07, 08). */
  vote?: ApplicationVoteResult
  applicant: ApplicantSummary & {
    displayName: string
    about: string | null
  }
  contacts?: {
    email: string
    city: string | null
    birthDate: string | null
  }
}
