import { sql } from 'kysely'
import type {
  BroadcastAttachment,
  BroadcastChannel,
  BroadcastSource,
} from '../contracts/broadcasts.ts'
import type { Executor } from '../db/client.ts'

/** Ключи блокировок: лимиты черновиков и шаблонов не обходятся гонкой. */
const DRAFTS_LOCK_KEY = 11_000_001
const TEMPLATES_LOCK_KEY = 11_000_002

export type DraftValues = {
  authorId: string
  subject: string | null
  body: string
  channels: BroadcastChannel[]
  attachments: BroadcastAttachment[]
  source: { kind: BroadcastSource; id: string } | null
}

export type TemplateValues = {
  authorId: string
  name: string
  subject: string | null
  body: string
  channels: BroadcastChannel[]
}

export const broadcastRepository = {
  drafts(db: Executor, limit: number) {
    return db
      .selectFrom('app.broadcast_drafts as d')
      .leftJoin('app.profiles as author', 'author.id', 'd.author_id')
      .select([
        'd.id',
        'd.subject',
        'd.body',
        'd.channels',
        'd.attachments',
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
        attachments: sql`cast(${JSON.stringify(values.attachments)}::text as jsonb)`,
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
