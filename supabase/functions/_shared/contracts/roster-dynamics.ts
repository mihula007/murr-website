import { z } from 'zod'
import {
  CHARACTER_STAT_FIELDS,
  type CharacterStatNumberField,
} from './character-stats.ts'
import { pageRequestShape, type Page } from './paging.ts'

export const dynamicsPeriodSchema = z
  .enum(['30', '90', '365', 'all'])
  .default('all')
const requestBase = {
  userId: z.guid(),
  ...pageRequestShape,
  period: dynamicsPeriodSchema,
}
export const dynamicsProfileSchema = z.object({ userId: z.guid() })
export const dynamicsStatsSchema = z.object({
  ...requestBase,
  fields: z
    .array(z.enum(CHARACTER_STAT_FIELDS))
    .min(1)
    .max(5)
    .default([...CHARACTER_STAT_FIELDS]),
})
export const dynamicsAttendanceSchema = z.object(requestBase)

export type DynamicsProfileResponse = {
  id: string
  gameNickname: string
  className: string
  avatarUrl: string | null
  displayName: string | null
  joinedOn: string | null
}
export type DynamicsStatPoint = {
  id: string
  field: CharacterStatNumberField
  value: number | null
  recordedAt: string
  kind: 'baseline' | 'checkpoint'
}
export type DynamicsStatsResponse = Page<DynamicsStatPoint>
export type DynamicsAttendancePoint = {
  weekStart: string
  visited: number
  missed: number
  unmarked: number
}
export type DynamicsAttendanceResponse = Page<DynamicsAttendancePoint>
