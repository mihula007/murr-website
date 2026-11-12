import type { AppDeps } from '../app.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import {
  listMarketSchema,
  MARKET_CATEGORY_LABELS,
  saveListingSchema,
  type ListingDetails,
  type MarketCategory,
  type MarketListResponse,
} from '../contracts/market.ts'
import { materialIdSchema, type MaterialCard } from '../contracts/materials.ts'
import { parseTimestamp } from '../contracts/moscow-time.ts'
import { SMALL_LIST_LIMIT } from '../contracts/paging.ts'
import {
  hasMeaningfulContent,
  type RichDocument,
} from '../contracts/rich-text.ts'
import { withTransaction } from '../db/client.ts'
import { ApiError } from '../http/errors.ts'
import { numberedPage, pageWindow } from '../http/numbered-page.ts'
import { parseBody } from '../http/validation.ts'
import {
  deriveFields,
  likePattern,
  matchingCategories,
} from '../materials/derive.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import {
  listingRepository as repo,
  type ListingFilter,
  type ListingRow,
} from './repository.ts'

/**
 * Раздел «Внутри клана» (MKT-01, Q-04): читают и создают член, офицер и
 * администратор. Права рынка отдельны от публикаций (02-page-map).
 */
const TRADERS = INTERNAL_ROLES

const iso = (value: string) => parseTimestamp(value).toISOString()

/**
 * Управление объявлением (MKT-06, MKT-07): администратор — любое, член и
 * офицер — только своё. Офицер не получает доступа к чужим объявлениям.
 */
export function canManageListing(
  viewer: ProfiledActor,
  authorId: string | null,
) {
  const role = viewer.profile.access_role
  if (role === 'admin') {
    return true
  }
  return (role === 'member' || role === 'officer') && authorId === viewer.userId
}

/** Черновик виден автору и администратору (MKT-05). */
function canView(viewer: ProfiledActor, row: ListingRow) {
  return row.status === 'published' || canManageListing(viewer, row.author_id)
}

function toCard(row: ListingRow): MaterialCard<MarketCategory> {
  return {
    id: row.id,
    category: row.category as MarketCategory,
    title: row.title,
    summary: row.summary,
    excerpt: row.excerpt,
    coverUrl: row.cover_url,
    status: row.status as MaterialCard<MarketCategory>['status'],
    updatedAt: iso(row.updated_at),
    // Подпись обязательна (MKT-03); удалённый автор — «Пользователь удалён».
    author: row.author_nickname
      ? { state: 'shown', gameNickname: row.author_nickname }
      : { state: 'deleted' },
    discussionEnabled: row.discussion_enabled,
  }
}

/**
 * Лента (MKT-05, MKT-11): опубликованные — нумерованные страницы по 50
 * (Q-55); черновики — свои (член, офицер) или все (администратор), до 50.
 */
export async function listListings(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<MarketListResponse> {
  const viewer = requireRole(actor, TRADERS)
  const input = parseBody(listMarketSchema, body)
  const drafts = input.tab === 'drafts'
  const filter: ListingFilter = {
    status: drafts ? 'draft' : 'published',
    authorId:
      drafts && viewer.profile.access_role !== 'admin' ? viewer.userId : null,
    category: input.category,
    search: input.search
      ? {
          pattern: likePattern(input.search),
          categories: matchingCategories(MARKET_CATEGORY_LABELS, input.search),
        }
      : null,
  }
  if (drafts) {
    const rows = await repo.list(deps.db, filter, {
      offset: 0,
      limit: SMALL_LIST_LIMIT + 1,
    })
    const items = rows.slice(0, SMALL_LIST_LIMIT).map(toCard)
    return {
      ...numberedPage(items, items.length, 1),
      truncated: rows.length > SMALL_LIST_LIMIT,
      canCreate: true,
    }
  }
  const [rows, total] = await Promise.all([
    repo.list(deps.db, filter, pageWindow(input.page)),
    repo.count(deps.db, filter),
  ])
  return {
    ...numberedPage(rows.map(toCard), total, input.page),
    truncated: false,
    canCreate: true,
  }
}

async function loadDetails(
  deps: AppDeps,
  viewer: ProfiledActor,
  id: string,
): Promise<ListingDetails> {
  const row = await repo.find(deps.db, id)
  if (!row || !canView(viewer, row)) {
    throw new ApiError('not_found')
  }
  const content = await repo.content(deps.db, id)
  return {
    ...toCard(row),
    content: content as unknown as RichDocument,
    createdAt: iso(row.created_at),
    publishedAt: row.published_at ? iso(row.published_at) : null,
    canManage: canManageListing(viewer, row.author_id),
  }
}

export async function getListing(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ListingDetails> {
  const viewer = requireRole(actor, TRADERS)
  const { id } = parseBody(materialIdSchema, body)
  return loadDetails(deps, viewer, id)
}

const target = (id: string) => ({ kind: 'market_listing', id })

/** Создание или правка объявления (MKT-03–MKT-07); файлов нет (MKT-08). */
export async function saveListing(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ListingDetails> {
  const trader = requireRole(actor, TRADERS)
  const input = parseBody(saveListingSchema, body)
  if (!hasMeaningfulContent(input.content)) {
    throw new ApiError('validation_failed', { content: 'empty' })
  }
  const values = {
    category: input.category,
    title: input.title,
    summary: input.summary,
    content: input.content,
    ...deriveFields(input),
    status: input.status,
    discussionEnabled: input.discussionEnabled,
  }
  const now = deps.now().toISOString()
  const id = await withTransaction(deps.db, async (tx) => {
    let listingId: string
    let action: { action: string; summary: string }
    if (input.id) {
      const row = await repo.lock(tx, input.id)
      if (!row) {
        throw new ApiError('not_found')
      }
      if (!canManageListing(trader, row.author_id)) {
        // Чужой черновик не раскрывается даже существованием.
        throw new ApiError(row.status === 'draft' ? 'not_found' : 'forbidden')
      }
      if (
        input.expectedUpdatedAt &&
        iso(row.updated_at) !== input.expectedUpdatedAt
      ) {
        throw new ApiError('state_conflict')
      }
      listingId = row.id
      await repo.update(tx, row.id, {
        ...values,
        now,
        publishedAt:
          input.status === 'published'
            ? (row.published_at ?? now)
            : row.published_at,
      })
      action =
        row.status === input.status
          ? { action: 'listing_updated', summary: 'Изменение объявления' }
          : input.status === 'published'
            ? { action: 'listing_published', summary: 'Публикация объявления' }
            : {
                action: 'listing_unpublished',
                summary: 'Снятие объявления с публикации',
              }
    } else {
      listingId = await repo.create(tx, {
        ...values,
        authorId: trader.userId,
        now,
      })
      action =
        input.status === 'published'
          ? { action: 'listing_published', summary: 'Публикация объявления' }
          : { action: 'listing_created', summary: 'Создание объявления' }
    }
    await writeAudit(tx, {
      category: 'market',
      ...action,
      actor: auditPerson(trader),
      target: target(listingId),
      details: {
        listing_id: listingId,
        title: input.title,
        category: input.category,
        status: input.status,
      },
    })
    return listingId
  })
  return loadDetails(deps, trader, id)
}

/** Строка под блокировкой с проверкой права; чужой черновик — not_found. */
async function lockManaged(
  tx: Parameters<typeof repo.lock>[0],
  trader: ProfiledActor,
  id: string,
) {
  const row = await repo.lock(tx, id)
  if (!row) {
    throw new ApiError('not_found')
  }
  if (!canManageListing(trader, row.author_id)) {
    throw new ApiError(row.status === 'draft' ? 'not_found' : 'forbidden')
  }
  return row
}

/** Снятие с публикации — в черновики (MKT-06, приёмка MKT 4). */
export async function unpublishListing(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ListingDetails> {
  const trader = requireRole(actor, TRADERS)
  const { id } = parseBody(materialIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const row = await lockManaged(tx, trader, id)
    if (row.status !== 'published') {
      throw new ApiError('state_conflict')
    }
    await repo.unpublish(tx, id, deps.now().toISOString())
    await writeAudit(tx, {
      category: 'market',
      action: 'listing_unpublished',
      summary: 'Снятие объявления с публикации',
      actor: auditPerson(trader),
      target: target(id),
      details: { listing_id: id, status: 'draft' },
    })
  })
  return loadDetails(deps, trader, id)
}

/** Удаление объявления (MKT-09); автор не удаляется. */
export async function deleteListing(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<{ deleted: true }> {
  const trader = requireRole(actor, TRADERS)
  const { id } = parseBody(materialIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    await lockManaged(tx, trader, id)
    await repo.delete(tx, id)
    await writeAudit(tx, {
      category: 'market',
      action: 'listing_deleted',
      summary: 'Удаление объявления',
      actor: auditPerson(trader),
      target: target(id),
      details: { listing_id: id },
    })
  })
  return { deleted: true }
}
