import { sql } from 'kysely'
import type {
  BroadcastChannel,
  BroadcastSource,
  SendableChannel,
} from '../contracts/broadcasts.ts'
import type { Executor } from '../db/client.ts'
import type { NicknameKey } from '../roster/repository.ts'
import { INTERNAL_ROLES } from '../membership.ts'

/** Ключи блокировок: лимиты черновиков и шаблонов не обходятся гонкой. */
const DRAFTS_LOCK_KEY = 11_000_001
const TEMPLATES_LOCK_KEY = 11_000_002

export type DraftValues = {
  authorId: string
  subject: string | null
  body: string
  channels: BroadcastChannel[]
  source: { kind: BroadcastSource; id: string } | null
}

export type TemplateValues = {
  authorId: string
  name: string
  subject: string | null
  body: string
  channels: BroadcastChannel[]
}

export type SubscriptionPageOptions = {
  search: string | null
  unlinkedOnly: boolean
  after: NicknameKey | null
  limit: number
}

export type RecipientPageOptions = {
  channels: SendableChannel[]
  classId: number | null
  search: string | null
  after: NicknameKey | null
  groupId: string | null
  eventId: string | null
  limit: number
}

function containsPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

export const broadcastRepository = {
  /** Страница состава и только признаков наличия привязок (BRC-15). */
  subscriptions(db: Executor, options: SubscriptionPageOptions) {
    let query = db
      .selectFrom('app.profiles as p')
      .leftJoin('app.telegram_links as t', 't.user_id', 'p.id')
      .leftJoin('app.vk_links as v', 'v.user_id', 'p.id')
      .leftJoin('app.max_links as m', 'm.user_id', 'p.id')
      .select([
        'p.id',
        'p.game_nickname',
        'p.access_role',
        't.user_id as telegram_linked',
        't.blocked_at as telegram_blocked_at',
        'v.user_id as vk_linked',
        'v.blocked_at as vk_blocked_at',
        'm.user_id as max_linked',
        'm.blocked_at as max_blocked_at',
      ])
      .where('p.access_role', 'in', INTERNAL_ROLES)
    if (options.search) {
      query = query.where(
        'p.game_nickname',
        'ilike',
        containsPattern(options.search),
      )
    }
    if (options.unlinkedOnly) {
      query = query
        .where('t.user_id', 'is', null)
        .where('v.user_id', 'is', null)
        .where('m.user_id', 'is', null)
    }
    if (options.after) {
      const { gameNickname, id } = options.after
      query = query.where((eb) =>
        eb(
          eb.refTuple('p.game_nickname', 'p.id'),
          '>',
          eb.tuple(gameNickname, id),
        ),
      )
    }
    return query
      .orderBy('p.game_nickname')
      .orderBy('p.id')
      .limit(options.limit)
      .execute()
  },

  /** Unique active recipients in the current audience for a cursor page (BRC-16). */
  recipientPage(db: Executor, options: RecipientPageOptions) {
    let query = db
      .selectFrom('app.profiles as p')
      .leftJoin('app.telegram_links as t', 't.user_id', 'p.id')
      .leftJoin('app.vk_links as v', 'v.user_id', 'p.id')
      .leftJoin('app.max_links as m', 'm.user_id', 'p.id')
      .select([
        'p.id',
        'p.game_nickname',
        't.user_id as telegram_linked',
        't.blocked_at as telegram_blocked_at',
        'v.user_id as vk_linked',
        'v.blocked_at as vk_blocked_at',
        'm.user_id as max_linked',
        'm.blocked_at as max_blocked_at',
      ])
      .where('p.access_role', 'in', INTERNAL_ROLES)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('app.user_deletions as d')
              .select('d.user_id')
              .whereRef('d.user_id', '=', 'p.id'),
          ),
        ),
      )
    if (options.search) {
      query = query.where(
        'p.game_nickname',
        'ilike',
        containsPattern(options.search),
      )
    }
    if (options.classId !== null) {
      query = query.where('p.class_id', '=', options.classId)
    }
    if (options.after) {
      const { gameNickname, id } = options.after
      query = query.where((eb) =>
        eb(
          eb.refTuple('p.game_nickname', 'p.id'),
          '>',
          eb.tuple(gameNickname, id),
        ),
      )
    }
    if (options.groupId) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('app.event_group_members as g')
            .select('g.user_id')
            .where('g.group_id', '=', options.groupId!)
            .whereRef('g.user_id', '=', 'p.id'),
        ),
      )
    }
    if (options.eventId) {
      query = query.where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('app.event_attendance as a')
              .select('a.user_id')
              .where('a.event_id', '=', options.eventId!)
              .whereRef('a.user_id', '=', 'p.id'),
          ),
        ),
      )
    }
    query = query.where((eb) =>
      eb.or(
        options.channels.map((channel) => {
          switch (channel) {
            case 'telegram':
              return eb.exists(
                eb
                  .selectFrom('app.telegram_links as l')
                  .select('l.user_id')
                  .whereRef('l.user_id', '=', 'p.id')
                  .where('l.blocked_at', 'is', null),
              )
            case 'vk':
              return eb.exists(
                eb
                  .selectFrom('app.vk_links as l')
                  .select('l.user_id')
                  .whereRef('l.user_id', '=', 'p.id')
                  .where('l.blocked_at', 'is', null),
              )
            case 'max':
              return eb.exists(
                eb
                  .selectFrom('app.max_links as l')
                  .select('l.user_id')
                  .whereRef('l.user_id', '=', 'p.id')
                  .where('l.blocked_at', 'is', null),
              )
          }
        }),
      ),
    )
    return query
      .orderBy('p.game_nickname')
      .orderBy('p.id')
      .limit(options.limit)
      .execute()
  },

  drafts(db: Executor, limit: number) {
    return db
      .selectFrom('app.broadcast_drafts as d')
      .leftJoin('app.profiles as author', 'author.id', 'd.author_id')
      .select([
        'd.id',
        'd.subject',
        'd.body',
        'd.channels',
        'd.author_id',
        'd.created_at',
        'author.game_nickname as author_nickname',
      ])
      .orderBy('d.created_at', 'desc')
      .orderBy('d.id', 'desc')
      .limit(limit)
      .execute()
  },

  async lockDrafts(tx: Executor) {
    await sql`select pg_advisory_xact_lock(${DRAFTS_LOCK_KEY})`.execute(tx)
  },

  async createDraft(tx: Executor, values: DraftValues) {
    const row = await tx
      .insertInto('app.broadcast_drafts')
      .values({
        author_id: values.authorId,
        subject: values.subject,
        body: values.body,
        channels: values.channels,
        source_kind: values.source?.kind ?? null,
        source_id: values.source?.id ?? null,
        created_at: sql<string>`clock_timestamp()`,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  },

  /** Оставляет `keep` последних черновиков (Q-69); возвращает число удалённых. */
  async trimDrafts(tx: Executor, keep: number) {
    const result = await tx
      .deleteFrom('app.broadcast_drafts')
      .where(
        'id',
        'not in',
        tx
          .selectFrom('app.broadcast_drafts')
          .select('id')
          .orderBy('created_at', 'desc')
          .orderBy('id', 'desc')
          .limit(keep),
      )
      .executeTakeFirst()
    return Number(result.numDeletedRows)
  },

  findDraft(db: Executor, id: string) {
    return db
      .selectFrom('app.broadcast_drafts')
      .select(['id', 'author_id', 'subject'])
      .where('id', '=', id)
      .executeTakeFirst()
  },

  async deleteDraft(tx: Executor, id: string) {
    await tx.deleteFrom('app.broadcast_drafts').where('id', '=', id).execute()
  },

  templates(db: Executor, limit: number) {
    return db
      .selectFrom('app.broadcast_templates as t')
      .leftJoin('app.profiles as author', 'author.id', 't.author_id')
      .select([
        't.id',
        't.name',
        't.subject',
        't.body',
        't.channels',
        't.author_id',
        'author.game_nickname as author_nickname',
      ])
      .orderBy('t.name')
      .orderBy('t.id')
      .limit(limit)
      .execute()
  },

  async lockTemplates(tx: Executor) {
    await sql`select pg_advisory_xact_lock(${TEMPLATES_LOCK_KEY})`.execute(tx)
  },

  async countTemplates(db: Executor) {
    const row = await db
      .selectFrom('app.broadcast_templates')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  async templateNameTaken(db: Executor, name: string) {
    const row = await db
      .selectFrom('app.broadcast_templates')
      .select('id')
      .where(sql`lower(name)`, '=', name.toLowerCase())
      .executeTakeFirst()
    return !!row
  },

  async createTemplate(tx: Executor, values: TemplateValues) {
    const row = await tx
      .insertInto('app.broadcast_templates')
      .values({
        author_id: values.authorId,
        name: values.name,
        subject: values.subject,
        body: values.body,
        channels: values.channels,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  },

  findTemplate(db: Executor, id: string) {
    return db
      .selectFrom('app.broadcast_templates')
      .select(['id', 'author_id', 'name'])
      .where('id', '=', id)
      .executeTakeFirst()
  },

  async deleteTemplate(tx: Executor, id: string) {
    await tx
      .deleteFrom('app.broadcast_templates')
      .where('id', '=', id)
      .execute()
  },

  /** Состав группы в порядке группы с никами (BRC-04). */
  groupMembers(db: Executor, groupId: string) {
    return db
      .selectFrom('app.event_group_members as m')
      .innerJoin('app.profiles as p', 'p.id', 'm.user_id')
      .select(['p.game_nickname', 'm.is_leader'])
      .where('m.group_id', '=', groupId)
      .orderBy('m.position')
      .execute()
  },
}
