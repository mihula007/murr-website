import type { ThreadRef } from '@contracts/discussions'

/** Ключи кеша обсуждений; ветка — по родителю (DSC-01). */
export const discussionKeys = {
  all: ['discussions'] as const,
  thread: (ref: ThreadRef) =>
    ['discussions', 'thread', ref.parent, ref.parentId] as const,
  changes: (ref: ThreadRef) =>
    ['discussions', 'changes', ref.parent, ref.parentId] as const,
  readers: (messageId: string) =>
    ['discussions', 'readers', messageId] as const,
  reactions: (messageId: string) =>
    ['discussions', 'reactions', messageId] as const,
}
