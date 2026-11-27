import { sql } from 'kysely'
import type { Executor } from '../db/client.ts'
import { INTERNAL_ROLES } from '../membership.ts'

/** Ключ блокировки создания шаблонов групп (лимит 20 не обходится гонкой). */
const TEMPLATES_LOCK_KEY = 7_000_001

type TemplateGroupInput = {
  name: string
  members: { userId: string; isLeader: boolean }[]
}

async function insertTemplateGroups(
  tx: Executor,
  templateId: string,
  groups: TemplateGroupInput[],
) {
  for (const [position, group] of groups.entries()) {
    const row = await tx
      .insertInto('app.group_template_groups')
      .values({ template_id: templateId, name: group.name, position })
      .returning('id')
      .executeTakeFirstOrThrow()
    if (group.members.length > 0) {
      await tx
        .insertInto('app.group_template_members')
        .values(
          group.members.map((member, index) => ({
            template_id: templateId,
            group_id: row.id,
            user_id: member.userId,
            position: index,
            is_leader: member.isLeader,
          })),
        )
        .execute()
    }
  }
}

export type GroupMemberRow = {
  group_id: string
  user_id: string
  is_leader: boolean
  game_nickname: string
  class_id: number
  class_name: string
  pa: number | string | null
  pz: number | string | null
  bu: number | string | null
  hp: number | string | null
  bd: number | string | null
}

export const groupRepository = {
  /** Группы события по порядку создания. */
  groups(db: Executor, eventId: string) {
    return db
      .selectFrom('app.event_groups')
      .select(['id', 'name'])
      .where('event_id', '=', eventId)
      .orderBy('created_at')
      .orderBy('id')
      .execute()
  },

  /** Участники групп события по порядку в группе. */
  members(db: Executor, eventId: string): Promise<GroupMemberRow[]> {
    return db
      .selectFrom('app.event_group_members as m')
      .innerJoin('app.profiles as p', 'p.id', 'm.user_id')
      .leftJoin('app.event_activity_records as r', (join) =>
        join
          .onRef('r.user_id', '=', 'm.user_id')
          .onRef('r.event_id', '=', 'm.event_id'),
      )
      .innerJoin('app.character_classes as c', (join) =>
        join.on('c.id', '=', sql`coalesce(r.class_id, p.class_id)`),
      )
      .select([
        'm.group_id',
        'm.user_id',
        'm.is_leader',
        sql<string>`coalesce(r.nickname, p.game_nickname)`.as('game_nickname'),
        sql<number>`coalesce(r.class_id, p.class_id)`.as('class_id'),
        'c.name as class_name',
        'p.pa',
        'p.pz',
        'p.bu',
        'p.hp',
        'p.bd',
      ])
      .where('m.event_id', '=', eventId)
      .orderBy('m.group_id')
      .orderBy('m.position')
      .execute()
  },

  poolPage(
    db: Executor,
    input: {
      eventId: string
      roles: readonly string[]
      tab: 'yes' | 'no' | 'maybe' | 'none'
      classIds?: number[]
      sortBy?: 'pa' | 'pz' | 'bu' | 'hp' | 'bd' | null
      direction?: 'asc' | 'desc'
      after?: [string | null, string, string] | null
      limit: number
    },
  ) {
    let query = db
      .selectFrom('app.profiles as p')
      .leftJoin('app.event_attendance as a', (join) =>
        join
          .onRef('a.user_id', '=', 'p.id')
          .on('a.event_id', '=', input.eventId),
      )
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .select([
        'p.id',
        'p.game_nickname',
        'p.class_id',
        'c.name as class_name',
        'p.avatar_path',
        'p.pa',
        'p.pz',
        'p.bu',
        'p.hp',
        'p.bd',
        'a.answer',
      ])
      .where((eb) =>
        eb.or([
          eb('p.access_role', 'in', input.roles),
          eb('a.event_id', 'is not', null),
        ]),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('app.event_group_members as m')
              .select('m.user_id')
              .whereRef('m.user_id', '=', 'p.id')
              .where('m.event_id', '=', input.eventId),
          ),
        ),
      )
    query =
      input.tab === 'none'
        ? query.where('a.answer', 'is', null)
        : query.where('a.answer', '=', input.tab)
    if (input.classIds?.length) {
      query = query.where('p.class_id', 'in', input.classIds)
    }
    if (input.after) {
      if (!input.sortBy) {
        query = query.where((eb) =>
          eb.or([
            eb('p.game_nickname', '>', input.after![1]),
            eb.and([
              eb('p.game_nickname', '=', input.after![1]),
              eb('p.id', '>', input.after![2]),
            ]),
          ]),
        )
      } else if (input.after[0] === null) {
        query = query
          .where(input.sortBy, 'is', null)
          .where((eb) =>
            eb.or([
              eb('p.game_nickname', '>', input.after![1]!),
              eb.and([
                eb('p.game_nickname', '=', input.after![1]!),
                eb('p.id', '>', input.after![2]!),
              ]),
            ]),
          )
      } else {
        const direction = input.direction === 'asc' ? '>' : '<'
        const stat = sql.ref(`p.${input.sortBy}`)
        query = query.where(
          sql<boolean>`(${stat} is null or ${stat} ${sql.raw(direction)} ${input.after[0]}::numeric or (${stat} = ${input.after[0]}::numeric and (p.game_nickname, p.id) > (${input.after[1]}, ${input.after[2]})))`,
        )
      }
    }
    if (input.sortBy) {
      const direction = input.direction ?? 'desc'
      query = query.orderBy(sql.ref(`p.${input.sortBy}`), (order) =>
        (direction === 'asc' ? order.asc() : order.desc()).nullsLast(),
      )
    }
    return query
      .orderBy('p.game_nickname')
      .orderBy('p.id')
      .limit(input.limit)
      .execute()
  },

  async poolCounts(db: Executor, eventId: string, roles: readonly string[]) {
    const count = async (answer: 'yes' | 'no' | 'maybe' | null) => {
      let query = db
        .selectFrom('app.profiles as p')
        .leftJoin('app.event_attendance as a', (join) =>
          join.onRef('a.user_id', '=', 'p.id').on('a.event_id', '=', eventId),
        )
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where((eb) =>
          eb.or([
            eb('p.access_role', 'in', roles),
            eb('a.event_id', 'is not', null),
          ]),
        )
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('app.event_group_members as m')
                .select('m.user_id')
                .whereRef('m.user_id', '=', 'p.id')
                .where('m.event_id', '=', eventId),
            ),
          ),
        )
      query =
        answer === null
          ? query.where('a.answer', 'is', null)
          : query.where('a.answer', '=', answer)
      const row = await query.executeTakeFirstOrThrow()
      return Number(row.count)
    }
    return Promise.all([
      count('yes'),
      count('no'),
      count('maybe'),
      count(null),
    ]).then(([yes, no, maybe, none]) => ({ yes, no, maybe, none }))
  },

  async countGroups(db: Executor, eventId: string) {
    const row = await db
      .selectFrom('app.event_groups')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('event_id', '=', eventId)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  /**
   * Новая группа. Порядок групп — по времени создания: `clock_timestamp()`
   * различается даже у вставок одной транзакции (применение шаблона).
   */
  async createGroup(tx: Executor, value: { eventId: string; name: string }) {
    const row = await tx
      .insertInto('app.event_groups')
      .values({
        event_id: value.eventId,
        name: value.name,
        created_at: sql<string>`clock_timestamp()`,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  },

  findGroup(db: Executor, groupId: string) {
    return db
      .selectFrom('app.event_groups')
      .select(['id', 'event_id', 'name'])
      .where('id', '=', groupId)
      .executeTakeFirst()
  },

  async renameGroup(tx: Executor, groupId: string, name: string) {
    await tx
      .updateTable('app.event_groups')
      .set({ name })
      .where('id', '=', groupId)
      .execute()
  },

  /** Удаляет группу; участники возвращаются в пул каскадом (GRP-09). */
  async deleteGroup(tx: Executor, groupId: string) {
    await tx.deleteFrom('app.event_groups').where('id', '=', groupId).execute()
  },

  /** Удаляет все группы события (применение шаблона, GRP-15). */
  async deleteGroupsOf(tx: Executor, eventId: string) {
    await tx
      .deleteFrom('app.event_groups')
      .where('event_id', '=', eventId)
      .execute()
  },

  membership(db: Executor, eventId: string, userId: string) {
    return db
      .selectFrom('app.event_group_members')
      .select(['group_id', 'position', 'is_leader'])
      .where('event_id', '=', eventId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
  },

  async groupSize(db: Executor, groupId: string) {
    const row = await db
      .selectFrom('app.event_group_members')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('group_id', '=', groupId)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  async removeMember(tx: Executor, eventId: string, userId: string) {
    await tx
      .deleteFrom('app.event_group_members')
      .where('event_id', '=', eventId)
      .where('user_id', '=', userId)
      .execute()
  },

  /**
   * Сдвигает позиции группы начиная с `from` на `delta`. Уникальность
   * позиции проверяется в конце транзакции (deferrable), поэтому
   * промежуточные совпадения допустимы.
   */
  async shiftPositions(
    tx: Executor,
    groupId: string,
    from: number,
    delta: 1 | -1,
  ) {
    await tx
      .updateTable('app.event_group_members')
      .set((eb) => ({ position: eb('position', '+', delta) }))
      .where('group_id', '=', groupId)
      .where('position', '>=', from)
      .execute()
  },

  async insertMember(
    tx: Executor,
    value: {
      eventId: string
      groupId: string
      userId: string
      position: number
      isLeader: boolean
    },
  ) {
    await tx
      .insertInto('app.event_group_members')
      .values({
        event_id: value.eventId,
        group_id: value.groupId,
        user_id: value.userId,
        position: value.position,
        is_leader: value.isLeader,
      })
      .execute()
  },

  /** Лидер группы: сначала снимается прежний, затем назначается новый. */
  async setLeader(tx: Executor, groupId: string, userId: string | null) {
    await tx
      .updateTable('app.event_group_members')
      .set({ is_leader: false })
      .where('group_id', '=', groupId)
      .where('is_leader', '=', true)
      .execute()
    if (userId === null) {
      return
    }
    await tx
      .updateTable('app.event_group_members')
      .set({ is_leader: true })
      .where('group_id', '=', groupId)
      .where('user_id', '=', userId)
      .execute()
  },

  /** Роли пользователей: назначать можно только текущий состав (GRP-05). */
  async rolesOf(db: Executor, userIds: readonly string[]) {
    if (userIds.length === 0) {
      return new Map<string, string>()
    }
    const rows = await db
      .selectFrom('app.profiles')
      .select(['id', 'access_role'])
      .where('id', 'in', userIds)
      .execute()
    return new Map(rows.map((row) => [row.id, row.access_role]))
  },

  /** Ответившие «Приду» на событие (применение шаблона, GRP-15). */
  async yesAnswers(db: Executor, eventId: string) {
    const rows = await db
      .selectFrom('app.event_attendance')
      .select('user_id')
      .where('event_id', '=', eventId)
      .where('answer', '=', 'yes')
      .execute()
    return new Set(rows.map((row) => row.user_id))
  },

  /**
   * Итог закрытия одним запросом (ACT-01, ACT-02): текущий состав и все,
   * кто стоит в группах. В группе — «Посетил» с названием группы и
   * лидерством; вне группы с ответом — «Не посетил»; без ответа —
   * «Не отметился». Ник и класс копируются (ACT-03).
   */
  async writeRecords(tx: Executor, eventId: string, roles: readonly string[]) {
    await tx
      .insertInto('app.event_activity_records')
      .columns([
        'event_id',
        'user_id',
        'nickname',
        'class_id',
        'status',
        'group_name',
        'is_leader',
      ])
      .expression((eb) =>
        eb
          .selectFrom('app.profiles as p')
          .leftJoin('app.event_group_members as m', (join) =>
            join.onRef('m.user_id', '=', 'p.id').on('m.event_id', '=', eventId),
          )
          .leftJoin('app.event_groups as g', 'g.id', 'm.group_id')
          .leftJoin('app.event_attendance as a', (join) =>
            join.onRef('a.user_id', '=', 'p.id').on('a.event_id', '=', eventId),
          )
          .select((s) => [
            sql<string>`${eventId}::uuid`.as('event_id'),
            'p.id as user_id',
            'p.game_nickname as nickname',
            'p.class_id',
            s
              .case()
              .when('m.user_id', 'is not', null)
              .then('visited')
              .when('a.user_id', 'is not', null)
              .then('missed')
              .else('unmarked')
              .end()
              .as('status'),
            'g.name as group_name',
            s.fn.coalesce('m.is_leader', sql<boolean>`false`).as('is_leader'),
          ])
          .where((w) =>
            w.or([
              w('p.access_role', 'in', roles),
              w('m.user_id', 'is not', null),
            ]),
          ),
      )
      .execute()
  },

  /** Число записей итога по статусам (для аудита закрытия). */
  async recordCounts(db: Executor, eventId: string) {
    const rows = await db
      .selectFrom('app.event_activity_records')
      .select((eb) => ['status', eb.fn.countAll<string>().as('count')])
      .where('event_id', '=', eventId)
      .groupBy('status')
      .execute()
    const counts = { visited: 0, missed: 0, unmarked: 0 }
    for (const row of rows) {
      counts[row.status as keyof typeof counts] = Number(row.count)
    }
    return counts
  },

  async markClosed(
    tx: Executor,
    eventId: string,
    value: { at: string; by: string },
  ) {
    await tx
      .updateTable('app.events')
      .set({ closed_at: value.at, closed_by: value.by, updated_at: value.at })
      .where('id', '=', eventId)
      .execute()
  },

  /**
   * Участники закрытого события из итога: ник и класс на момент закрытия,
   * аватар — из текущего профиля, ответ — сохранённый.
   */
  records(db: Executor, eventId: string, limit: number) {
    return db
      .selectFrom('app.event_activity_records as r')
      .innerJoin('app.profiles as p', 'p.id', 'r.user_id')
      .innerJoin('app.character_classes as c', 'c.id', 'r.class_id')
      .leftJoin('app.event_attendance as a', (join) =>
        join
          .onRef('a.user_id', '=', 'r.user_id')
          .onRef('a.event_id', '=', 'r.event_id'),
      )
      .select([
        'r.user_id as id',
        'r.nickname as game_nickname',
        'r.class_id',
        'c.name as class_name',
        'p.avatar_path',
        'a.answer',
        'r.status',
      ])
      .where('r.event_id', '=', eventId)
      .orderBy('r.nickname')
      .orderBy('r.user_id')
      .limit(limit)
      .execute()
  },

  // --- Шаблоны групп ---

  templates(db: Executor, limit: number) {
    return db
      .selectFrom('app.group_templates as t')
      .leftJoin('app.profiles as author', 'author.id', 't.created_by')
      .select(['t.id', 't.name', 'author.game_nickname as author_nickname'])
      .orderBy('t.created_at', 'desc')
      .orderBy('t.id', 'desc')
      .limit(limit)
      .execute()
  },

  template(db: Executor, id: string) {
    return db
      .selectFrom('app.group_templates as t')
      .leftJoin('app.profiles as author', 'author.id', 't.created_by')
      .select(['t.id', 't.name', 'author.game_nickname as author_nickname'])
      .where('t.id', '=', id)
      .executeTakeFirst()
  },

  templateGroupCounts(db: Executor, templateIds: readonly string[]) {
    if (templateIds.length === 0) {
      return Promise.resolve([])
    }
    return db
      .selectFrom('app.group_template_groups')
      .select((eb) => ['template_id', eb.fn.countAll<string>().as('count')])
      .where('template_id', 'in', templateIds)
      .groupBy('template_id')
      .execute()
  },

  templateMemberCounts(db: Executor, templateIds: readonly string[]) {
    if (templateIds.length === 0) {
      return Promise.resolve([])
    }
    return db
      .selectFrom('app.group_template_members as m')
      .innerJoin('app.profiles as p', 'p.id', 'm.user_id')
      .select((eb) => ['m.template_id', eb.fn.countAll<string>().as('count')])
      .where('m.template_id', 'in', templateIds)
      .where('p.access_role', 'in', INTERNAL_ROLES)
      .groupBy('m.template_id')
      .execute()
  },

  templateGroups(db: Executor, templateIds: readonly string[]) {
    if (templateIds.length === 0) {
      return Promise.resolve([])
    }
    return db
      .selectFrom('app.group_template_groups')
      .select(['id', 'template_id', 'name'])
      .where('template_id', 'in', templateIds)
      .orderBy('template_id')
      .orderBy('position')
      .execute()
  },

  /** Участники шаблонов с текущими ником и классом. */
  templateMembers(db: Executor, templateIds: readonly string[]) {
    if (templateIds.length === 0) {
      return Promise.resolve([])
    }
    return db
      .selectFrom('app.group_template_members as m')
      .innerJoin('app.profiles as p', 'p.id', 'm.user_id')
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .select([
        'm.template_id',
        'm.group_id',
        'm.user_id',
        'm.is_leader',
        'p.game_nickname',
        'p.class_id',
        'c.name as class_name',
        'p.access_role',
        'p.pa',
        'p.pz',
        'p.bu',
        'p.hp',
        'p.bd',
      ])
      .where('m.template_id', 'in', templateIds)
      .orderBy('m.group_id')
      .orderBy('m.position')
      .execute()
  },

  async countTemplates(db: Executor) {
    const row = await db
      .selectFrom('app.group_templates')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  /** Сериализует создание шаблонов, чтобы лимит не обходился гонкой. */
  async lockTemplates(tx: Executor) {
    await sql`select pg_advisory_xact_lock(${TEMPLATES_LOCK_KEY})`.execute(tx)
  },

  lockTemplate(tx: Executor, id: string) {
    return tx
      .selectFrom('app.group_templates')
      .select(['id', 'name'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst()
  },

  async createTemplate(
    tx: Executor,
    value: {
      name: string
      createdBy: string
      groups: TemplateGroupInput[]
    },
  ) {
    const template = await tx
      .insertInto('app.group_templates')
      .values({ name: value.name, created_by: value.createdBy })
      .returning('id')
      .executeTakeFirstOrThrow()
    await insertTemplateGroups(tx, template.id, value.groups)
    return template.id
  },

  async updateTemplate(
    tx: Executor,
    value: { id: string; name: string; groups: TemplateGroupInput[] },
  ) {
    await tx
      .updateTable('app.group_templates')
      .set({ name: value.name })
      .where('id', '=', value.id)
      .returning('id')
      .executeTakeFirstOrThrow()
    await tx
      .deleteFrom('app.group_template_groups')
      .where('template_id', '=', value.id)
      .execute()
    await insertTemplateGroups(tx, value.id, value.groups)
  },

  /** Удаляет шаблон; возвращает удалённую строку или undefined. */
  deleteTemplate(tx: Executor, id: string) {
    return tx
      .deleteFrom('app.group_templates')
      .where('id', '=', id)
      .returning(['id', 'name'])
      .executeTakeFirst()
  },

  /** Создаёт группы события по порядку с участниками (применение шаблона). */
  async insertGroups(
    tx: Executor,
    eventId: string,
    groups: {
      name: string
      members: { userId: string; isLeader: boolean }[]
    }[],
  ) {
    for (const group of groups) {
      const groupId = await groupRepository.createGroup(tx, {
        eventId,
        name: group.name,
      })
      if (group.members.length > 0) {
        await tx
          .insertInto('app.event_group_members')
          .values(
            group.members.map((member, position) => ({
              event_id: eventId,
              group_id: groupId,
              user_id: member.userId,
              position,
              is_leader: member.isLeader,
            })),
          )
          .execute()
      }
    }
  },
}
