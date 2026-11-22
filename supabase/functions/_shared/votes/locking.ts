import type { Executor } from '../db/client.ts'
import { ApiError } from '../http/errors.ts'
import { voteRepository } from './repository.ts'

/** Голосование с блокировкой для синхронизации ответов и замены анонса. */
export async function lockActiveVote(
  tx: Executor,
  id: string,
  mode: 'share' | 'update',
) {
  const vote = await voteRepository.lock(tx, id, mode)
  if (!vote) {
    throw new ApiError('not_found')
  }
  if (vote.closed_at !== null) {
    throw new ApiError('state_conflict')
  }
  return vote
}
