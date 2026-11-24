import type { Actor } from '../auth/actor.ts'
import { requireRole } from '../auth/actor.ts'
import {
  forgeCatalogRequestSchema,
  type ForgeCatalogResponse,
} from '../contracts/forge.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import { decodeCursor, encodeCursor } from '../http/cursor.ts'
import { parseBody } from '../http/validation.ts'
import { FORGE_CATALOGS } from '../../../../shared/forge/catalogs.ts'
import { z } from 'zod'

const cursorSchema = z.tuple([z.string(), z.string()])
const normalize = (value: string) => value.trim().toLocaleLowerCase('ru-RU')
const compareKeys = (
  left: { normalizedName: string; id: string },
  right: { normalizedName: string; id: string },
) =>
  left.normalizedName.localeCompare(right.normalizedName, 'ru-RU') ||
  left.id.localeCompare(right.id)

export async function listForgeCatalog(
  actor: Actor,
  body: unknown,
): Promise<ForgeCatalogResponse> {
  requireRole(actor, INTERNAL_ROLES)
  const input = parseBody(forgeCatalogRequestSchema, body)
  const query = normalize(input.search)
  const rows = FORGE_CATALOGS[input.kind]
    .filter(
      (item) =>
        (!query || normalize(item.name).includes(query)) &&
        (!input.slot || item.slot === input.slot),
    )
    .map((item) => ({ ...item, normalizedName: normalize(item.name) }))
    .sort(compareKeys)
  let after: readonly [string, string] | null = null
  if (input.cursor) {
    after = decodeCursor(cursorSchema, input.cursor)
  }
  const filtered = after
    ? rows.filter(
        (row) =>
          compareKeys(row, { normalizedName: after![0], id: after![1] }) > 0,
      )
    : rows
  const page = filtered.slice(0, input.limit)
  const last = page.at(-1)
  const hasMore = filtered.length > page.length
  return {
    items: page.map(({ normalizedName: _normalizedName, ...item }) => item),
    nextCursor:
      hasMore && last ? encodeCursor([last.normalizedName, last.id]) : null,
  }
}
