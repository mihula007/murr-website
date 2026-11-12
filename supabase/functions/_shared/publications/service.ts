import type { AppDeps } from '../app.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import type { MaterialAuthor, MaterialCard } from '../contracts/materials.ts'
import { parseTimestamp } from '../contracts/moscow-time.ts'
import { SMALL_LIST_LIMIT } from '../contracts/paging.ts'
import {
  discardUploadsSchema,
  listPublicationsSchema,
  PUBLICATION_CATEGORY_LABELS,
  publicationUploadSchema,
  savePublicationSchema,
  type PublicationCategory,
  type PublicationDetails,
  type PublicationFileType,
  type PublicationListResponse,
  type PublicationUploadResponse,
} from '../contracts/publications.ts'
import { materialIdSchema } from '../contracts/materials.ts'
import {
  hasMeaningfulContent,
  type RichDocument,
} from '../contracts/rich-text.ts'
import { withTransaction } from '../db/client.ts'
import { isUniqueViolation } from '../db/errors.ts'
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
  attachmentUrls,
  isOwnUploadPath,
  newUploadPath,
  PUBLICATION_BUCKET,
  removeFiles,
  staleUploads,
  verifyUpload,
} from './files.ts'
import {
  publicationRepository as repo,
  type PublicationFilter,
  type PublicationRow,
} from './repository.ts'

/** Читают внутренние роли (PUB, ACL); создают офицеры и администраторы (Q-02). */
const READERS = INTERNAL_ROLES
export const PUBLICATION_EDITORS = ['officer', 'admin'] as const

const ATTACHMENT_PATH_CONSTRAINT = 'publication_attachments_path_key'

const iso = (value: string) => parseTimestamp(value).toISOString()

/**
 * Право на правку, публикацию, снятие и удаление (ACL-11, Q-03):
 * администратор — любой материал, офицер — только свой.
 */
export function canManagePublication(
  viewer: ProfiledActor,
  authorId: string | null,
) {
  const role = viewer.profile.access_role
  return role === 'admin' || (role === 'officer' && authorId === viewer.userId)
}

/** Черновик виден автору-редактору и администратору (PUB-05). */
function canView(viewer: ProfiledActor, row: PublicationRow) {
  return (
    row.status === 'published' || canManagePublication(viewer, row.author_id)
  )
}

/** Подпись: скрыта флагом от читателя, но не от редактора (PUB-07, PUB-17). */
function authorOf(viewer: ProfiledActor, row: PublicationRow): MaterialAuthor {
  if (!row.show_author && !canManagePublication(viewer, row.author_id)) {
    return null
  }
  return row.author_nickname
    ? { state: 'shown', gameNickname: row.author_nickname }
    : { state: 'deleted' }
}

function toCard(
  viewer: ProfiledActor,
  row: PublicationRow,
  coverUrl: string | null,
): MaterialCard<PublicationCategory> {
  return {
    id: row.id,
    category: row.category as PublicationCategory,
    title: row.title,
    summary: row.summary,
    excerpt: row.excerpt,
    coverUrl: coverUrl ?? row.cover_url,
    status: row.status as MaterialCard<PublicationCategory>['status'],
    updatedAt: iso(row.updated_at),
    author: authorOf(viewer, row),
    discussionEnabled: row.discussion_enabled,
  }
}

/** Карточки с обложкой: первое вложение (подписанная ссылка) или URL. */
async function toCards(
  deps: AppDeps,
  viewer: ProfiledActor,
  rows: PublicationRow[],
) {
  const covers = await repo.covers(
    deps.db,
    rows.map((row) => row.id),
  )
  const urls = await attachmentUrls(
    deps.storage,
    covers.map((cover) => cover.path),
  )
  const coverOf = new Map(
    covers.map((cover) => [cover.publication_id, urls.get(cover.path) ?? null]),
  )
  return rows.map((row) => toCard(viewer, row, coverOf.get(row.id) ?? null))
}

/**
 * Лента (PUB-01, PUB-09): опубликованные — нумерованные страницы по 50
 * (Q-55); черновики — свои (офицер) или все (администратор), до 50.
 */
export async function listPublications(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<PublicationListResponse> {
  const viewer = requireRole(actor, READERS)
  const input = parseBody(listPublicationsSchema, body)
  const role = viewer.profile.access_role
  const canCreate = (PUBLICATION_EDITORS as readonly string[]).includes(role)
  const drafts = input.tab === 'drafts'
  if (drafts && !canCreate) {
    throw new ApiError('forbidden')
  }
  const filter: PublicationFilter = {
    status: drafts ? 'draft' : 'published',
    authorId: drafts && role !== 'admin' ? viewer.userId : null,
    category: input.category,
    search: input.search
      ? {
          pattern: likePattern(input.search),
          categories: matchingCategories(
            PUBLICATION_CATEGORY_LABELS,
            input.search,
          ),
          authorAlways: role === 'admin',
        }
      : null,
  }
  if (drafts) {
    const rows = await repo.list(deps.db, filter, {
      offset: 0,
      limit: SMALL_LIST_LIMIT + 1,
    })
    const items = await toCards(deps, viewer, rows.slice(0, SMALL_LIST_LIMIT))
    return {
      ...numberedPage(items, items.length, 1),
      truncated: rows.length > SMALL_LIST_LIMIT,
      canCreate,
    }
  }
  const [rows, total] = await Promise.all([
    repo.list(deps.db, filter, pageWindow(input.page)),
    repo.count(deps.db, filter),
  ])
  return {
    ...numberedPage(await toCards(deps, viewer, rows), total, input.page),
    truncated: false,
    canCreate,
  }
}

async function loadDetails(
  deps: AppDeps,
  viewer: ProfiledActor,
  id: string,
): Promise<PublicationDetails> {
  const row = await repo.find(deps.db, id)
  if (!row || !canView(viewer, row)) {
    throw new ApiError('not_found')
  }
  const [content, attachments] = await Promise.all([
    repo.content(deps.db, id),
    repo.attachments(deps.db, [id]),
  ])
  const urls = await attachmentUrls(
    deps.storage,
    attachments.map((file) => file.path),
  )
  const firstFile = attachments[0]
  const card = toCard(
    viewer,
    row,
    firstFile ? (urls.get(firstFile.path) ?? null) : null,
  )
  return {
    ...card,
    content: content as unknown as RichDocument,
    createdAt: iso(row.created_at),
    publishedAt: row.published_at ? iso(row.published_at) : null,
    canManage: canManagePublication(viewer, row.author_id),
    showAuthor: row.show_author,
    attachments: attachments.map((file) => ({
      path: file.path,
      fileName: file.file_name,
      url: urls.get(file.path) ?? null,
    })),
  }
}

export async function getPublication(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<PublicationDetails> {
  const viewer = requireRole(actor, READERS)
  const { id } = parseBody(materialIdSchema, body)
  return loadDetails(deps, viewer, id)
}

/** Подписанная ссылка загрузки в свою папку (PUB-13). */
export async function createPublicationUpload(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<PublicationUploadResponse> {
  const editor = requireRole(actor, PUBLICATION_EDITORS)
  const { contentType } = parseBody(publicationUploadSchema, body)
  const upload = await deps.storage.createUploadUrl(
    PUBLICATION_BUCKET,
    newUploadPath(editor.userId, contentType, deps.now()),
  )
  return { bucket: PUBLICATION_BUCKET, ...upload }
}

/** Свои загрузки, не привязанные ни к одной публикации. */
async function unreferenced(deps: AppDeps, userId: string, paths: string[]) {
  const own = paths.filter((path) => isOwnUploadPath(userId, path))
  const owned = new Set(
    (await repo.owners(deps.db, own)).map((owner) => owner.path),
  )
  return own.filter((path) => !owned.has(path))
}

/** Отмена редактора удаляет его новые непривязанные файлы (PUB-16). */
export async function discardPublicationUploads(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<{ removed: number }> {
  const editor = requireRole(actor, PUBLICATION_EDITORS)
  const { paths } = parseBody(discardUploadsSchema, body)
  const removable = await unreferenced(deps, editor.userId, paths)
  await removeFiles(deps.storage, removable)
  return { removed: removable.length }
}

const target = (id: string) => ({ kind: 'publication', id })

/**
 * Создание или правка (PUB-02–PUB-06, PUB-13): права, версия, проверка
 * новых файлов, вложения и аудит — одна транзакция; удалённые из материала
 * файлы и брошенные загрузки удаляются после коммита.
 */
export async function savePublication(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<PublicationDetails> {
  const editor = requireRole(actor, PUBLICATION_EDITORS)
  const input = parseBody(savePublicationSchema, body)
  if (!hasMeaningfulContent(input.content) && input.attachments.length === 0) {
    throw new ApiError('validation_failed', { content: 'empty' })
  }

  // Файлы: уже привязанные к этой публикации берутся из БД, новые
  // проверяются в Storage до транзакции (сетевые запросы).
  const current = input.id ? await repo.attachments(deps.db, [input.id]) : []
  const currentByPath = new Map(current.map((file) => [file.path, file]))
  const owners = await repo.owners(
    deps.db,
    input.attachments.map((file) => file.path),
  )
  for (const owner of owners) {
    if (owner.publication_id !== input.id) {
      throw new ApiError('publication_file_invalid')
    }
  }
  const files = await Promise.all(
    input.attachments.map(async (file) => {
      const existing = currentByPath.get(file.path)
      const meta = existing
        ? {
            size: existing.size,
            contentType: existing.content_type as PublicationFileType,
          }
        : await verifyUpload(deps.storage, editor.userId, file.path)
      return { path: file.path, fileName: file.fileName, ...meta }
    }),
  )

  const derived = deriveFields({
    title: input.title,
    summary: input.summary,
    content: input.content,
    fileNames: files.map((file) => file.fileName),
  })
  const values = {
    category: input.category,
    title: input.title,
    summary: input.summary,
    content: input.content,
    ...derived,
    status: input.status,
    showAuthor: input.showAuthor,
    discussionEnabled: input.discussionEnabled,
  }
  const now = deps.now().toISOString()

  let id: string
  try {
    id = await withTransaction(deps.db, async (tx) => {
      let publicationId: string
      let action: { action: string; summary: string }
      if (input.id) {
        const row = await repo.lock(tx, input.id)
        if (!row) {
          throw new ApiError('not_found')
        }
        if (!canManagePublication(editor, row.author_id)) {
          // Чужой черновик не раскрывается даже существованием.
          throw new ApiError(row.status === 'draft' ? 'not_found' : 'forbidden')
        }
        if (
          input.expectedUpdatedAt &&
          iso(row.updated_at) !== input.expectedUpdatedAt
        ) {
          throw new ApiError('state_conflict')
        }
        publicationId = row.id
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
            ? { action: 'publication_updated', summary: 'Изменение публикации' }
            : input.status === 'published'
              ? {
                  action: 'publication_published',
                  summary: 'Публикация материала',
                }
              : {
                  action: 'publication_unpublished',
                  summary: 'Снятие публикации с публикации',
                }
      } else {
        publicationId = await repo.create(tx, {
          ...values,
          authorId: editor.userId,
          now,
        })
        action =
          input.status === 'published'
            ? {
                action: 'publication_published',
                summary: 'Публикация материала',
              }
            : { action: 'publication_created', summary: 'Создание публикации' }
      }
      await repo.replaceAttachments(tx, publicationId, files)
      await writeAudit(tx, {
        category: 'publications',
        ...action,
        actor: auditPerson(editor),
        target: target(publicationId),
        details: {
          publication_id: publicationId,
          title: input.title,
          category: input.category,
          status: input.status,
        },
      })
      return publicationId
    })
  } catch (error) {
    // Тот же файл одновременно привязан к другой публикации.
    if (isUniqueViolation(error, ATTACHMENT_PATH_CONSTRAINT)) {
      throw new ApiError('publication_file_invalid')
    }
    throw error
  }

  const kept = new Set(files.map((file) => file.path))
  await removeFiles(
    deps.storage,
    current.map((file) => file.path).filter((path) => !kept.has(path)),
  )
  await removeFiles(
    deps.storage,
    await unreferenced(
      deps,
      editor.userId,
      await staleUploads(deps.storage, editor.userId, deps.now()),
    ),
  )
  return loadDetails(deps, editor, id)
}

/** Снятие с публикации — в черновики (PUB-06). */
export async function unpublishPublication(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<PublicationDetails> {
  const editor = requireRole(actor, PUBLICATION_EDITORS)
  const { id } = parseBody(materialIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const row = await repo.lock(tx, id)
    if (!row) {
      throw new ApiError('not_found')
    }
    if (!canManagePublication(editor, row.author_id)) {
      throw new ApiError(row.status === 'draft' ? 'not_found' : 'forbidden')
    }
    if (row.status !== 'published') {
      throw new ApiError('state_conflict')
    }
    await repo.unpublish(tx, id, deps.now().toISOString())
    await writeAudit(tx, {
      category: 'publications',
      action: 'publication_unpublished',
      summary: 'Снятие публикации с публикации',
      actor: auditPerson(editor),
      target: target(id),
      details: { publication_id: id, status: 'draft' },
    })
  })
  return loadDetails(deps, editor, id)
}

/** Удаление материала и его вложений (PUB-06, PUB-16). */
export async function deletePublication(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<{ deleted: true }> {
  const editor = requireRole(actor, PUBLICATION_EDITORS)
  const { id } = parseBody(materialIdSchema, body)
  const paths = await withTransaction(deps.db, async (tx) => {
    const row = await repo.lock(tx, id)
    if (!row) {
      throw new ApiError('not_found')
    }
    if (!canManagePublication(editor, row.author_id)) {
      throw new ApiError(row.status === 'draft' ? 'not_found' : 'forbidden')
    }
    const files = await repo.attachments(tx, [id])
    await repo.delete(tx, id)
    await writeAudit(tx, {
      category: 'publications',
      action: 'publication_deleted',
      summary: 'Удаление публикации',
      actor: auditPerson(editor),
      target: target(id),
      details: { publication_id: id },
    })
    return files.map((file) => file.path)
  })
  await removeFiles(deps.storage, paths)
  return { deleted: true }
}
