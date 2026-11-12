import type { DiscussionParent } from '../contracts/discussions.ts'
import type { Executor } from '../db/client.ts'
import { discussionRepository } from './repository.ts'

/** Счётчик сообщений ветки на карточках родителей (DSC-01): один запрос. */
export async function withMessageCounts<T extends { id: string }>(
  db: Executor,
  parent: DiscussionParent,
  items: T[],
): Promise<(T & { messageCount: number })[]> {
  const counts = await discussionRepository.countByParent(
    db,
    parent,
    items.map((item) => item.id),
  )
  return items.map((item) => ({
    ...item,
    messageCount: counts.get(item.id) ?? 0,
  }))
}
