import type { Executor } from '../db/client.ts'
import type { VoteKind } from '../contracts/votes.ts'
import { normalizeOptionLabel } from '../contracts/votes.ts'

/** Ключ сортировки истории: время завершения и `id`, по убыванию. */
export type ClosedKey = { closedAt: string; id: string }

export type VoteListOptions =
  | { tab: 'active'; limit: number }
  | { tab: 'history'; after: ClosedKey | null; limit: number }

/** Голосование с ником создателя и (для заявочного) ником и классом кандидата. */
function selectVotes(db: Executor) {
  return db
    .selectFrom('app.votes as v')
    .leftJoin('app.profiles as author', 'author.id', 'v.created_by')
    .leftJoin('app.join_applications as a', 'a.id', 'v.application_id')
    .leftJoin('app.profiles as cand', 'cand.id', 'a.applicant_id')
    .leftJoin('app.character_classes as c', 'c.id', 'cand.class_id')
    .select([
      'v.id',
      'v.kind',
      'v.title',
      'v.context',
      'v.created_at',
      'v.closed_at',
      'v.application_id',
      'author.game_nickname as author_nickname',
      'cand.game_nickname as applicant_nickname',
      'c.name as applicant_class_name',
    ])
}

export type VoteRow = Awaited<
  ReturnType<ReturnType<typeof selectVotes>['executeTakeFirstOrThrow']>
>

export const voteRepository = {
  async create(
    tx: Executor,
    vote: {
      kind: VoteKind
      title: string
      context: string
      createdBy: string
      applicationId: string | null
    },
    labels: readonly string[],
  ) {
    const row = await tx
      .insertInto('app.votes')
      .values({
        kind: vote.kind,
        title: vote.title,
        context: vote.context,
        created_by: vote.createdBy,
        application_id: vote.applicationId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await tx
      .insertInto('app.vote_options')
      .values(
        labels.map((label, position) => ({
          vote_id: row.id,
          label,
          normalized_label: normalizeOptionLabel(label),
          position,
        })),
      )
      .execute()
    return row.id
  },

  list(db: Executor, options: VoteListOptions) {
    let query = selectVotes(db)
    if (options.tab === 'active') {
      query = query
        .where('v.closed_at', 'is', null)
        .orderBy('v.created_at', 'desc')
        .orderBy('v.id', 'desc')
    } else {
      const { after } = options
      query = query.where('v.closed_at', 'is not', null)
      if (after) {
        // Keyset по убыванию: строки строго «раньше» последней показанной.
        query = query.where((eb) =>
          eb(
            eb.refTuple('v.closed_at', 'v.id'),
            '<',
            eb.tuple(after.closedAt, after.id),
          ),
        )
      }
      query = query.orderBy('v.closed_at', 'desc').orderBy('v.id', 'desc')
    }
    return query.limit(options.limit).execute()
  },

  find(db: Executor, id: string) {
    return selectVotes(db).where('v.id', '=', id).executeTakeFirst()
  },

  /** Последнее голосование по заявке (активное или завершённое). */
  findByApplication(db: Executor, applicationId: string) {
    return selectVotes(db)
      .where('v.application_id', '=', applicationId)
      .orderBy('v.created_at', 'desc')
      .limit(1)
      .executeTakeFirst()
  },

  /** Голосования нескольких заявок (для очереди окончательных решений). */
  forApplications(db: Executor, applicationIds: readonly string[]) {
    if (applicationIds.length === 0) {
      return Promise.resolve([])
    }
    return db
      .selectFrom('app.votes')
      .select(['id', 'application_id', 'closed_at', 'created_at'])
      .where('application_id', 'in', applicationIds)
      .orderBy('created_at', 'desc')
      .execute()
  },

  async countActive(db: Executor) {
    const row = await db
      .selectFrom('app.votes')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('closed_at', 'is', null)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  /**
   * Строка голосования с блокировкой. `share` — для голоса: параллельные
   * голоса не мешают друг другу, но завершение ждёт их и наоборот.
   */
  lock(tx: Executor, id: string, mode: 'share' | 'update') {
    const query = tx
      .selectFrom('app.votes')
      .select(['id', 'kind', 'title', 'closed_at', 'application_id'])
      .where('id', '=', id)
    return (
      mode === 'share' ? query.forShare() : query.forUpdate()
    ).executeTakeFirst()
  },

  /** Итоги по вариантам нескольких голосований, в порядке вариантов. */
  async totals(db: Executor, voteIds: readonly string[]) {
    if (voteIds.length === 0) {
      return []
    }
    const rows = await db
      .selectFrom('app.vote_options as o')
      .leftJoin('app.vote_ballots as b', 'b.option_id', 'o.id')
      .select((eb) => [
        'o.id',
        'o.vote_id',
        'o.label',
        'o.position',
        eb.fn.count<string>('b.id').as('count'),
      ])
      .where('o.vote_id', 'in', voteIds)
      .groupBy('o.id')
      .orderBy('o.vote_id')
      .orderBy('o.position')
      .execute()
    return rows.map((row) => ({ ...row, count: Number(row.count) }))
  },

  /** Выбор пользователя в нескольких голосованиях: vote_id → option_id. */
  async choicesOf(db: Executor, voteIds: readonly string[], voterId: string) {
    if (voteIds.length === 0) {
      return new Map<string, string>()
    }
    const rows = await db
      .selectFrom('app.vote_ballots')
      .select(['vote_id', 'option_id'])
      .where('vote_id', 'in', voteIds)
      .where('voter_id', '=', voterId)
      .execute()
    return new Map(rows.map((row) => [row.vote_id, row.option_id]))
  },

  /** Голоса с никами для офицера и администратора; удалённые — в конце. */
  ballots(db: Executor, voteId: string, limit: number) {
    return db
      .selectFrom('app.vote_ballots as b')
      .leftJoin('app.profiles as p', 'p.id', 'b.voter_id')
      .select(['b.id', 'b.option_id', 'p.game_nickname'])
      .where('b.vote_id', '=', voteId)
      .orderBy('p.game_nickname', (ob) => ob.asc().nullsLast())
      .orderBy('b.id')
      .limit(limit)
      .execute()
  },

  async hasOption(db: Executor, voteId: string, optionId: string) {
    const row = await db
      .selectFrom('app.vote_options')
      .select('id')
      .where('vote_id', '=', voteId)
      .where('id', '=', optionId)
      .executeTakeFirst()
    return row !== undefined
  },

  /** Создаёт или меняет текущий голос участника (VOT-05, VOT-06). */
  async upsertBallot(
    tx: Executor,
    ballot: { voteId: string; optionId: string; voterId: string; at: string },
  ) {
    await tx
      .insertInto('app.vote_ballots')
      .values({
        vote_id: ballot.voteId,
        option_id: ballot.optionId,
        voter_id: ballot.voterId,
        created_at: ballot.at,
        updated_at: ballot.at,
      })
      .onConflict((oc) =>
        oc
          .columns(['vote_id', 'voter_id'])
          .where('voter_id', 'is not', null)
          .doUpdateSet({ option_id: ballot.optionId, updated_at: ballot.at })
          // Тот же выбор не трогает строку.
          .where('app.vote_ballots.option_id', '!=', ballot.optionId),
      )
      .execute()
  },

  async updateText(
    tx: Executor,
    id: string,
    values: { title: string; context: string; at: string },
  ) {
    await tx
      .updateTable('app.votes')
      .set({
        title: values.title,
        context: values.context,
        updated_at: values.at,
      })
      .where('id', '=', id)
      .execute()
  },

  async close(tx: Executor, id: string, closedBy: string, at: string) {
    await tx
      .updateTable('app.votes')
      .set({ closed_at: at, closed_by: closedBy, updated_at: at })
      .where('id', '=', id)
      .execute()
  },

  /** Удаляет голосование; варианты и голоса удаляются каскадом (VOT-11). */
  async delete(tx: Executor, id: string) {
    await tx.deleteFrom('app.votes').where('id', '=', id).execute()
  },
}
