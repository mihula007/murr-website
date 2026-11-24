import { z } from 'zod'
import { pageRequestShape } from './paging.ts'

export const forgeCatalogRequestSchema = z.object({
  kind: z.enum(['equipment', 'titles']),
  search: z.string().max(120).optional().default(''),
  slot: z.string().max(40).optional(),
  ...pageRequestShape,
})
export type ForgeCatalogRequest = z.output<typeof forgeCatalogRequestSchema>
export type ForgeCatalogResponse = {
  items: import('../../../../shared/forge/catalogs.ts').ForgeCatalogItem[]
  nextCursor: string | null
}
