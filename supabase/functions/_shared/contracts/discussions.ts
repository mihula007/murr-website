import { z } from 'zod'
import { pageRequestShape, type MemberList, type Page } from './paging.ts'

/** Родители веток обсуждения (DSC-01). */
export const DISCUSSION_PARENTS = [
  'event',
  'vote',
  'publication',
  'market',
] as const
export type DiscussionParent = (typeof DISCUSSION_PARENTS)[number]

/** Набор реакций (DSC-10, Q-60); порядок — порядок меню. */
export const REACTIONS = [
  '❤️',
  '👍',
  '👎',
  '😂',
  '🔥',
  '😢',
  '😭',
  '😐',
  '👌',
  '🤡',
] as const
export type Reaction = (typeof REACTIONS)[number]

/** Ограничения обсуждений (DSC-03, DSC-05, DSC-08, Q-58). */
export const DISCUSSION_LIMITS = {
  body: 2000,
  /** Начало цитируемого сообщения в ответе. */
  quote: 200,
  /** Окно правки своего сообщения. */
  editWindowMs: 5 * 60 * 1000,
  /** Сообщений в ответе опроса; больше — клиент перечитывает ветку. */
  changes: 100,
  /** Перекрытие окна опроса: сообщение, зафиксированное позже своего времени. */
  changesOverlapMs: 10 * 1000,
  /** Интервал опроса открытого окна (Q-58). */
  pollMs: 30 * 1000,
  /** Упоминаний, по которым создаются уведомления, в одном сообщении. */
  mentions: 20,
} as const

const threadShape = {
  parent: z.enum(DISCUSSION_PARENTS),
  parentId: z.guid(),
}

export type ThreadRef = { parent: DiscussionParent; parentId: string }

const bodySchema = z
  .string()
  .trim()
  .min(1, 'required')
  .max(DISCUSSION_LIMITS.body, 'too_long')

/** Момент времени из ответа сервера (`now`, `createdAt`). */
const instantSchema = z.iso.datetime({ offset: true, message: 'invalid' })

export const listDiscussionSchema = z.object({
  ...threadShape,
  ...pageRequestShape,
})

export const discussionChangesSchema = z.object({
  ...threadShape,
  since: instantSchema,
})

export const sendMessageSchema = z.object({
  ...threadShape,
  body: bodySchema,
  replyToId: z
    .guid()
    .nullish()
    .transform((value) => value ?? null),
})

export const editMessageSchema = z.object({
  messageId: z.guid(),
  body: bodySchema,
})

export const reactSchema = z.object({
  messageId: z.guid(),
  emoji: z.enum(REACTIONS, 'invalid'),
})

export const markReadSchema = z.object({
  ...threadShape,
  upTo: instantSchema,
})

export const messageIdSchema = z.object({ messageId: z.guid() })

/** Подпись автора: роль офицера/админа — значок (DSC-02); удалён — DSC-16. */
export type DiscussionAuthor =
  | {
      state: 'shown'
      id: string
      gameNickname: string
      avatarUrl: string | null
      badge: 'officer' | 'admin' | null
    }
  | { state: 'deleted' }

export type ReactionCount = { emoji: Reaction; count: number; mine: boolean }

export type DiscussionMessage = {
  id: string
  author: DiscussionAuthor
  mine: boolean
  body: string
  createdAt: string
  editedAt: string | null
  changedAt: string
  /** Цитата ответа по текущему тексту исходного сообщения (DSC-05). */
  replyTo: {
    id: string
    gameNickname: string | null
    excerpt: string
  } | null
  reactions: ReactionCount[]
}

/** Состояние ветки, общее для страницы и опроса. */
export type ThreadState = {
  /** Можно писать: родитель не завершён, материал опубликован (DSC-13, DSC-14). */
  canWrite: boolean
  /** Самая поздняя отметка прочтения других участников (DSC-12). */
  othersReadUpTo: string | null
  /** Время сервера: `since` следующего опроса и отсчёт окна правки. */
  now: string
}

export type DiscussionPage = Page<DiscussionMessage> & ThreadState

export type DiscussionChanges = ThreadState & {
  items: DiscussionMessage[]
  /** Изменений больше лимита — перечитать ветку с первой страницы. */
  reset: boolean
}

export type DiscussionPerson = {
  /** null — пользователь удалён (реакции остаются обезличенными, DSC-17). */
  gameNickname: string | null
  avatarUrl: string | null
}

export type DiscussionReaders = MemberList<DiscussionPerson>

export type DiscussionReactions = MemberList<
  DiscussionPerson & { emoji: Reaction }
>

/** Можно ли ещё править сообщение (DSC-08): на клиенте и на сервере. */
export function editableUntil(createdAt: string) {
  return new Date(
    new Date(createdAt).getTime() + DISCUSSION_LIMITS.editWindowMs,
  ).toISOString()
}

const MENTION = /(^|[^\p{L}\p{N}_@])@([^\s@]{1,40})/gu
const TRAILING_PUNCTUATION = /[.,!?:;)\]»"'…-]+$/u

/**
 * Упоминания `@ник` (DSC-07): кандидаты ника в нижнем регистре — слово
 * после `@` целиком и без завершающей пунктуации. Сопоставление с никами
 * выполняет сервер; клиент той же функцией подсвечивает упоминания.
 */
export function mentionCandidates(body: string): string[] {
  const found = new Set<string>()
  for (const match of body.matchAll(MENTION)) {
    const word = match[2] ?? ''
    for (const candidate of [word, word.replace(TRAILING_PUNCTUATION, '')]) {
      if (candidate) {
        found.add(candidate.toLocaleLowerCase('ru'))
      }
    }
  }
  return [...found]
}
