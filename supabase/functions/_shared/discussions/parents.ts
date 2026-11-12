import type { ProfiledActor } from '../auth/actor.ts'
import type { DiscussionParent, ThreadRef } from '../contracts/discussions.ts'
import type { Executor } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import { ApiError } from '../http/errors.ts'
import { canManageListing } from '../market/service.ts'
import { listingRepository } from '../market/repository.ts'
import { canManagePublication } from '../publications/service.ts'
import { publicationRepository } from '../publications/repository.ts'
import { voteRepository } from '../votes/repository.ts'

/** Что ветка наследует от родителя (DSC-13, DSC-14). */
export type ParentAccess = {
  title: string
  /** Писать, отвечать, править и менять реакции. */
  canWrite: boolean
  /** Цель уведомления: ведёт на родителя, доступа не даёт. */
  target: { kind: string; id: string }
}

type Material = {
  id: string
  title: string
  author_id: string | null
  status: string
  discussion_enabled: boolean
}

/**
 * Материал: читают те, кто видит его (чужой черновик — not_found, как в
 * этапе 8); писать можно только в опубликованный с включённым обсуждением.
 */
function materialAccess(
  row: Material | undefined,
  visible: (row: Material) => boolean,
  kind: string,
): ParentAccess {
  if (!row || !visible(row)) {
    throw new ApiError('not_found')
  }
  return {
    title: row.title,
    canWrite: row.status === 'published' && row.discussion_enabled,
    target: { kind, id: row.id },
  }
}

/**
 * Доступ к ветке следует родителю. Читатель уже проверен как внутренний
 * участник: события, голосования, публикации и рынок видят член, офицер и
 * администратор. `lock` — блокировка родителя на чтение для записи в ветку:
 * сообщение не проскочит после завершения, снятия или удаления родителя.
 */
export async function parentAccess(
  db: Executor,
  viewer: ProfiledActor,
  { parent, parentId }: ThreadRef,
  lock: boolean,
): Promise<ParentAccess> {
  switch (parent) {
    case 'event': {
      const row = lock
        ? await eventRepository.lock(db, parentId, 'share')
        : await eventRepository.find(db, parentId)
      if (!row) {
        throw new ApiError('not_found')
      }
      return {
        title: row.title,
        canWrite: row.closed_at === null,
        target: { kind: 'event', id: row.id },
      }
    }
    case 'vote': {
      const row = lock
        ? await voteRepository.lock(db, parentId, 'share')
        : await voteRepository.find(db, parentId)
      if (!row) {
        throw new ApiError('not_found')
      }
      return {
        title: row.title,
        canWrite: row.closed_at === null,
        target: { kind: 'vote', id: row.id },
      }
    }
    case 'publication': {
      const row = lock
        ? await publicationRepository.lockShared(db, parentId)
        : await publicationRepository.find(db, parentId)
      return materialAccess(
        row,
        (material) =>
          material.status === 'published' ||
          canManagePublication(viewer, material.author_id),
        'publication',
      )
    }
    case 'market': {
      const row = lock
        ? await listingRepository.lockShared(db, parentId)
        : await listingRepository.find(db, parentId)
      return materialAccess(
        row,
        (material) =>
          material.status === 'published' ||
          canManageListing(viewer, material.author_id),
        'market_listing',
      )
    }
  }
}

/** Родитель ветки по строке `discussion_threads`. */
export function parentOfThread(row: {
  event_id: string | null
  vote_id: string | null
  publication_id: string | null
  market_listing_id: string | null
}): ThreadRef {
  const pairs: [DiscussionParent, string | null][] = [
    ['event', row.event_id],
    ['vote', row.vote_id],
    ['publication', row.publication_id],
    ['market', row.market_listing_id],
  ]
  for (const [parent, parentId] of pairs) {
    if (parentId) {
      return { parent, parentId }
    }
  }
  throw new Error('Ветка без родителя')
}
