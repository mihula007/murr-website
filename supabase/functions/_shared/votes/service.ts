import { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { applicationRepository } from '../applications/repository.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import { MEMBER_LIST_LIMIT, SMALL_LIST_LIMIT } from '../contracts/paging.ts'
import {
  castBallotSchema,
  createVoteSchema,
  listVotesSchema,
  updateVoteSchema,
  voteIdSchema,
  type VoteDetails,
  type VoteKind,
  type VoteListResponse,
  type VoteOptionResult,
  type VoteSummary,
} from '../contracts/votes.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import { voteRepository, type VoteRow } from './repository.ts'

/** Читают и голосуют члены, офицеры и администраторы (ACL-04). */
const VOTERS = INTERNAL_ROLES
/** Создают и управляют офицеры и администраторы независимо от автора. */
export const VOTE_MANAGERS = ['officer', 'admin'] as const

const isManager = (actor: ProfiledActor) =>
  (VOTE_MANAGERS as readonly string[]).includes(actor.profile.access_role)

/** Курсор истории: `[closed_at, id]`. */
const closedCursor = z
  .tuple([z.string().min(1).max(64), z.guid()])
  .transform(([closedAt, id]) => ({ closedAt, id }))

/** Лидер — наибольшее число голосов больше нуля; при равенстве — все (VOT-07). */
export function withLeaders(
  options: { id: string; label: string; count: number }[],
): VoteOptionResult[] {
  const max = Math.max(0, ...options.map((option) => option.count))
  return options.map((option) => ({
    id: option.id,
    label: option.label,
    count: option.count,
    leading: max > 0 && option.count === max,
  }))
}

/** Итоги и свой голос для набора голосований — два запроса на страницу. */
async function summarize(
  db: Executor,
  rows: VoteRow[],
  viewerId: string,
): Promise<VoteSummary[]> {
  const ids = rows.map((row) => row.id)
  const [totals, choices] = await Promise.all([
    voteRepository.totals(db, ids),
    voteRepository.choicesOf(db, ids, viewerId),
  ])
  return rows.map((row) => {
    const options = withLeaders(totals.filter((t) => t.vote_id === row.id))
    return {
      id: row.id,
      kind: row.kind as VoteKind,
      title: row.title,
      context: row.context,
      createdAt: row.created_at,
      closedAt: row.closed_at,
      createdBy: row.author_nickname
        ? { gameNickname: row.author_nickname }
        : null,
      applicant:
        row.kind === 'application' && row.applicant_nickname
          ? {
              gameNickname: row.applicant_nickname,
              className: row.applicant_class_name ?? '',
            }
          : null,
      options,
      totalBallots: options.reduce((sum, option) => sum + option.count, 0),
      myOptionId: choices.get(row.id) ?? null,
    }
  })
}

export async function listVotes(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<VoteListResponse> {
  const viewer = requireRole(actor, VOTERS)
  const { tab, cursor, limit } = parseBody(listVotesSchema, body)
  const isActive = tab === 'active'
  // «Актуальные» — малый список: целиком, но не больше порога.
  const pageLimit = isActive ? SMALL_LIST_LIMIT : limit
  const [rows, activeCount] = await Promise.all([
    voteRepository.list(
      deps.db,
      isActive
        ? { tab, limit: pageLimit + 1 }
        : {
            tab,
            after: cursor ? decodeCursor(closedCursor, cursor) : null,
            limit: pageLimit + 1,
          },
    ),
    voteRepository.countActive(deps.db),
  ])
  const page = splitPage(rows, pageLimit, (row) => [row.closed_at, row.id])
  return {
    items: await summarize(deps.db, page.rows, viewer.userId),
    nextCursor: isActive ? null : page.nextCursor,
    activeCount,
    truncated: isActive && rows.length > pageLimit,
  }
}

/**
 * Карточка голосования. Членам — только итоги и свой голос; офицеру и
 * администратору — ещё голоса с никами и связанная заявка (VOT-07, Q-16).
 */
export async function loadVoteDetails(
  db: Executor,
  viewer: ProfiledActor,
  id: string,
): Promise<VoteDetails> {
  const row = await voteRepository.find(db, id)
  if (!row) {
    throw new ApiError('not_found')
  }
  const [summary] = await summarize(db, [row], viewer.userId)
  const details: VoteDetails = { ...summary! }
  if (isManager(viewer)) {
    const ballots = await voteRepository.ballots(db, id, MEMBER_LIST_LIMIT + 1)
    details.ballots = ballots.slice(0, MEMBER_LIST_LIMIT).map((ballot) => ({
      gameNickname: ballot.game_nickname,
      optionId: ballot.option_id,
    }))
    details.ballotsTruncated = ballots.length > MEMBER_LIST_LIMIT
    if (row.application_id) {
      details.applicationId = row.application_id
    }
  }
  return details
}

export async function getVote(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<VoteDetails> {
  const viewer = requireRole(actor, VOTERS)
  const { id } = parseBody(voteIdSchema, body)
  return loadVoteDetails(deps.db, viewer, id)
}

function voteTarget(id: string) {
  return { kind: 'vote', id }
}

/** Обычное голосование (VOT-02, VOT-03); заявочное — только из заявки. */
export async function createVote(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<VoteDetails> {
  const manager = requireRole(actor, VOTE_MANAGERS)
  const input = parseBody(createVoteSchema, body)
  const id = await withTransaction(deps.db, async (tx) => {
    const voteId = await voteRepository.create(
      tx,
      {
        kind: 'general',
        title: input.title,
        context: input.context,
        createdBy: manager.userId,
        applicationId: null,
      },
      input.options,
    )
    await writeAudit(tx, {
      category: 'votes',
      action: 'vote_created',
      summary: 'Создание голосования',
      actor: auditPerson(manager),
      target: voteTarget(voteId),
      details: { vote_id: voteId, vote_kind: 'general', title: input.title },
    })
    return voteId
  })
  return loadVoteDetails(deps.db, manager, id)
}

/** Активное голосование под блокировкой; иначе not_found / state_conflict. */
async function lockActive(tx: Executor, id: string, mode: 'share' | 'update') {
  const vote = await voteRepository.lock(tx, id, mode)
  if (!vote) {
    throw new ApiError('not_found')
  }
  if (vote.closed_at !== null) {
    throw new ApiError('state_conflict')
  }
  return vote
}

/**
 * Тема и контекст активного голосования (VOT-08); голоса сохраняются.
 * Тема голосования по заявке («Заявка: <ник>») не меняется.
 */
export async function updateVote(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<VoteDetails> {
  const manager = requireRole(actor, VOTE_MANAGERS)
  const input = parseBody(updateVoteSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const vote = await lockActive(tx, input.id, 'update')
    if (vote.kind === 'application' && input.title !== vote.title) {
      throw new ApiError('validation_failed', { title: 'locked' })
    }
    await voteRepository.updateText(tx, vote.id, {
      title: input.title,
      context: input.context,
      at: deps.now().toISOString(),
    })
    await writeAudit(tx, {
      category: 'votes',
      action: 'vote_updated',
      summary: 'Изменение голосования',
      actor: auditPerson(manager),
      target: voteTarget(vote.id),
      details: { vote_id: vote.id, vote_kind: vote.kind, title: input.title },
    })
  })
  return loadVoteDetails(deps.db, manager, input.id)
}

/**
 * Голос или смена голоса (VOT-05, VOT-06). Строка голосования блокируется
 * на чтение: голос не проходит после параллельного завершения. В аудит не
 * пишется (Q-41).
 */
export async function castBallot(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<VoteDetails> {
  const voter = requireRole(actor, VOTERS)
  const input = parseBody(castBallotSchema, body)
  await withTransaction(deps.db, async (tx) => {
    await lockActive(tx, input.voteId, 'share')
    if (!(await voteRepository.hasOption(tx, input.voteId, input.optionId))) {
      throw new ApiError('not_found')
    }
    await voteRepository.upsertBallot(tx, {
      voteId: input.voteId,
      optionId: input.optionId,
      voterId: voter.userId,
      at: deps.now().toISOString(),
    })
  })
  return loadVoteDetails(deps.db, voter, input.voteId)
}

/**
 * Завершение (VOT-09, Q-40: в любой момент, без кворума). Заявка связанного
 * голосования переходит к окончательному решению администратора (VOT-10).
 */
export async function closeVote(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<VoteDetails> {
  const manager = requireRole(actor, VOTE_MANAGERS)
  const { id } = parseBody(voteIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const vote = await lockActive(tx, id, 'update')
    const at = deps.now().toISOString()
    await voteRepository.close(tx, vote.id, manager.userId, at)
    if (vote.application_id) {
      await moveApplication(
        tx,
        vote.application_id,
        'pending_vote',
        'vote_completed',
        at,
      )
    }
    await writeAudit(tx, {
      category: 'votes',
      action: 'vote_closed',
      summary: 'Завершение голосования',
      actor: auditPerson(manager),
      target: voteTarget(vote.id),
      details: {
        vote_id: vote.id,
        vote_kind: vote.kind,
        title: vote.title,
        application_id: vote.application_id,
      },
    })
  })
  return loadVoteDetails(deps.db, manager, id)
}

/**
 * Удаление активного голосования с голосами (VOT-11). Заявка связанного
 * голосования возвращается в очередь офицера (APP-11).
 */
export async function deleteVote(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<{ deleted: true }> {
  const manager = requireRole(actor, VOTE_MANAGERS)
  const { id } = parseBody(voteIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const vote = await lockActive(tx, id, 'update')
    await voteRepository.delete(tx, vote.id)
    if (vote.application_id) {
      await moveApplication(
        tx,
        vote.application_id,
        'pending_vote',
        'pending_officer_review',
        deps.now().toISOString(),
      )
    }
    await writeAudit(tx, {
      category: 'votes',
      action: 'vote_deleted',
      summary: 'Удаление голосования',
      actor: auditPerson(manager),
      target: voteTarget(vote.id),
      details: {
        vote_id: vote.id,
        vote_kind: vote.kind,
        title: vote.title,
        application_id: vote.application_id,
      },
    })
  })
  return { deleted: true }
}

/** Переход связанной заявки; другой статус означает гонку. */
async function moveApplication(
  tx: Executor,
  applicationId: string,
  from: string,
  to: string,
  at: string,
) {
  if (
    !(await applicationRepository.transition(tx, applicationId, from, to, at))
  ) {
    throw new ApiError('state_conflict')
  }
}
