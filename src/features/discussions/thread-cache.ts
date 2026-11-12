import type { InfiniteData } from '@tanstack/react-query'
import type {
  DiscussionMessage,
  DiscussionPage,
  ThreadState,
} from '@contracts/discussions'

export type ThreadData = InfiniteData<DiscussionPage, unknown>

const newestFirst = (a: DiscussionMessage, b: DiscussionMessage) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)

/**
 * Сливает сообщения из ответа операции или опроса (Q-58) в загруженные
 * страницы ветки: известное сообщение заменяется на месте, новое попадает в
 * первую (самую свежую) страницу. Состояние ветки — из ответа, если оно есть.
 */
export function mergeMessages(
  data: ThreadData | undefined,
  messages: readonly DiscussionMessage[],
  state?: ThreadState,
): ThreadData | undefined {
  if (!data || data.pages.length === 0) {
    return data
  }
  const incoming = new Map(messages.map((message) => [message.id, message]))
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      const next = incoming.get(item.id)
      if (!next) {
        return item
      }
      incoming.delete(item.id)
      // Опрос с перекрытием может вернуть устаревшую копию — она не побеждает.
      return next.changedAt >= item.changedAt ? next : item
    }),
  }))
  const [first, ...rest] = pages
  const added = [...incoming.values()]
  return {
    ...data,
    pages: [
      {
        ...first!,
        ...(state ?? {}),
        items:
          added.length > 0
            ? [...added, ...first!.items].sort(newestFirst)
            : first!.items,
      },
      ...rest,
    ],
  }
}

/** Сообщения ветки от старых к новым — порядок отрисовки ленты. */
export function threadMessages(data: ThreadData | undefined) {
  if (!data) {
    return []
  }
  return data.pages.flatMap((page) => page.items).reverse()
}

/** Состояние ветки — из самой свежей страницы. */
export function threadState(data: ThreadData | undefined): ThreadState | null {
  const first = data?.pages[0]
  return first
    ? {
        canWrite: first.canWrite,
        othersReadUpTo: first.othersReadUpTo,
        now: first.now,
      }
    : null
}
