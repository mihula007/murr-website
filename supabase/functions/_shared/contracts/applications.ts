import { z } from 'zod'
import {
  equipmentLinksSchema,
  LIMITS,
  type ApplicationStatus,
} from './account.ts'

/** Размер страницы вкладки «Решённые». */
export const APPLICATION_PAGE_SIZE = 20

export const APPLICATION_TABS = ['new', 'decided'] as const
export type ApplicationTab = (typeof APPLICATION_TABS)[number]

export const listApplicationsSchema = z.object({
  tab: z.enum(APPLICATION_TABS),
  page: z.number().int().min(0).default(0),
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

export type ApplicationListItem = {
  id: string
  status: ApplicationStatus
  submittedAt: string
  decidedAt: string | null
  applicant: ApplicantSummary
}

export type ApplicationListResponse = {
  items: ApplicationListItem[]
  page: number
  hasMore: boolean
  /** Число новых заявок для счётчика вкладки. */
  newCount: number
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
