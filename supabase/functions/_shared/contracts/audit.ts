import { z } from 'zod'
import { pageRequestShape, type Page } from './paging.ts'

/** Категории журнала (ADM-12) — все, что пишет сервис аудита (Q-71). */
export const AUDIT_CATEGORIES = [
  'applications',
  'participants',
  'profiles',
  'events',
  'votes',
  'publications',
  'market',
  'broadcast',
] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  applications: 'Заявки',
  participants: 'Участники',
  profiles: 'Профили',
  events: 'Ивенты',
  votes: 'Голосования',
  publications: 'Публикации',
  market: 'Рынок',
  broadcast: 'Рассылка',
}

/** Журнал — большой список (Q-68): курсор по убыванию, фильтры на сервере. */
export const auditListSchema = z.object({
  ...pageRequestShape,
  category: z
    .enum(AUDIT_CATEGORIES)
    .nullish()
    .transform((value) => value ?? null),
  search: z
    .string()
    .trim()
    .max(100, 'too_long')
    .nullish()
    .transform((value) => value || null),
})
export type AuditListRequest = z.input<typeof auditListSchema>

export type AuditPersonView = {
  nickname: string | null
  role: string | null
  email: string | null
}

export type AuditEntry = {
  id: number
  createdAt: string
  category: AuditCategory
  action: string
  summary: string
  actor: AuditPersonView | null
  target: {
    kind: string
    id: string
    nickname: string | null
    email: string | null
  } | null
  details: Record<string, unknown>
}

export type AuditListResponse = Page<AuditEntry>
