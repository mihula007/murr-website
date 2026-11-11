import type { Executor } from '../db/client.ts'

/** Период по времени начала события, UTC: `[from, to)`. */
export type Period = { from: string | null; to: string | null }

/** Ключ истории: начало события и событие по убыванию, ник и пользователь по возрастанию. */
export type HistoryKey = {
  startsAt: string
  eventId: string
  nickname: string
  userId: string
}

/** Ключ списка закрытых событий и истории участника — по убыванию. */
export type EventKey = { startsAt: string; eventId: string }

/** Записи итога закрытых событий за период. */
function periodRecords(db: Executor, period: Period) {
  let query = db
    .selectFrom('app.event_activity_records as r')
    .innerJoin('app.events as e', 'e.id', 'r.event_id')
    .where('e.closed_at', 'is not', null)
  if (period.from) {
    query = query.where('e.starts_at', '>=', period.from)
  }
  if (period.to) {
    query = query.where('e.starts_at', '<', period.to)
  }
  return query
}

function closedEvents(db: Executor, period: Period) {
  let query = db
    .selectFrom('app.events as e')
    .where('e.closed_at', 'is not', null)
  if (period.from) {
    query = query.where('e.starts_at', '>=', period.from)
  }
  if (period.to) {
    query = query.where('e.starts_at', '<', period.to)
  }
  return query
}

export const activityRepository = {
  /**
   * Показатели по людям за период (сводка, рейтинг, топ-5): ник и класс —
   * из текущего профиля. Входят профили с ролью из `roles` (с нулями) и,
   * если `withRecorded`, все, у кого есть записи в периоде.
   */
  aggregate(
    db: Executor,
    options: {
      period: Period
      roles: readonly string[]
      withRecorded: boolean
      classId: number | null
      limit: number
    },
  ) {
    const records = periodRecords(db, options.period)
      .select(['r.user_id', 'r.status', 'r.is_leader'])
      .as('r')
    let query = db
      .selectFrom('app.profiles as p')
      .innerJoin('app.character_classes as c', 'c.id', 'p.class_id')
      .leftJoin(records, 'r.user_id', 'p.id')
      .select((eb) => [
        'p.id',
        'p.game_nickname',
        'p.class_id',
        'c.name as class_name',
        'p.access_role',
        'p.joined_on',
        eb.fn
          .count<string>('r.user_id')
          .filterWhere('r.status', '=', 'visited')
          .as('visited'),
        eb.fn
          .count<string>('r.user_id')
          .filterWhere('r.status', '=', 'missed')
          .as('missed'),
        eb.fn
          .count<string>('r.user_id')
          .filterWhere('r.status', '=', 'unmarked')
          .as('unmarked'),
        eb.fn
          .count<string>('r.user_id')
          .filterWhere('r.is_leader', '=', true)
          .as('leaders'),
        eb.fn.count<string>('r.user_id').as('total'),
      ])
      .where((eb) =>
        options.withRecorded
          ? eb.or([
              eb('p.access_role', 'in', options.roles),
              eb('r.user_id', 'is not', null),
            ])
          : eb('p.access_role', 'in', options.roles),
      )
    if (options.classId !== null) {
      query = query.where('p.class_id', '=', options.classId)
    }
    return query
      .groupBy(['p.id', 'c.name'])
      .orderBy(
        (eb) =>
          eb.fn.count('r.user_id').filterWhere('r.status', '=', 'visited'),
        'desc',
      )
      .orderBy('p.game_nickname')
      .orderBy('p.id')
      .limit(options.limit)
      .execute()
  },

  async countEvents(db: Executor, period: Period) {
    const row = await closedEvents(db, period)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return Number(row.count)
  },

  /** История (ACT-06): строки итога за период, новые события сверху. */
  history(
    db: Executor,
    options: {
      period: Period
      classId: number | null
      search: string | null
      userId: string | null
      after: HistoryKey | null
      limit: number
    },
  ) {
    let query = periodRecords(db, options.period)
      .innerJoin('app.character_classes as c', 'c.id', 'r.class_id')
      .innerJoin('app.profiles as p', 'p.id', 'r.user_id')
      .select([
        'e.id as event_id',
        'e.title',
        'e.starts_at',
        'r.user_id',
        'r.nickname',
        'r.class_id',
        'c.name as class_name',
        'r.group_name',
        'r.is_leader',
        'r.status',
        'p.access_role',
      ])
    if (options.classId !== null) {
      query = query.where('r.class_id', '=', options.classId)
    }
    if (options.userId !== null) {
      query = query.where('r.user_id', '=', options.userId)
    }
    if (options.search) {
      const pattern = `%${escapeLike(options.search)}%`
      query = query.where((eb) =>
        eb.or([
          eb('r.nickname', 'ilike', pattern),
          eb('e.title', 'ilike', pattern),
        ]),
      )
    }
    const after = options.after
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb('e.starts_at', '<', after.startsAt),
          eb.and([
            eb('e.starts_at', '=', after.startsAt),
            eb.or([
              eb('e.id', '<', after.eventId),
              eb.and([
                eb('e.id', '=', after.eventId),
                eb(
                  eb.refTuple('r.nickname', 'r.user_id'),
                  '>',
                  eb.tuple(after.nickname, after.userId),
                ),
              ]),
            ]),
          ]),
        ]),
      )
    }
    return query
      .orderBy('e.starts_at', 'desc')
      .orderBy('e.id', 'desc')
      .orderBy('r.nickname')
      .orderBy('r.user_id')
      .limit(options.limit)
      .execute()
  },

  /** Закрытые события периода для выбора «По мероприятию». */
  events(
    db: Executor,
    options: {
      period: Period
      search: string | null
      after: EventKey | null
      limit: number
    },
  ) {
    let query = closedEvents(db, options.period).select([
      'e.id',
      'e.title',
      'e.starts_at',
    ])
    if (options.search) {
      query = query.where('e.title', 'ilike', `%${escapeLike(options.search)}%`)
    }
    const after = options.after
    if (after) {
      query = query.where((eb) =>
        eb(
          eb.refTuple('e.starts_at', 'e.id'),
          '<',
          eb.tuple(after.startsAt, after.eventId),
        ),
      )
    }
    return query
      .orderBy('e.starts_at', 'desc')
      .orderBy('e.id', 'desc')
      .limit(options.limit)
      .execute()
  },

  findClosedEvent(db: Executor, eventId: string) {
    return closedEvents(db, { from: null, to: null })
      .select(['e.id', 'e.title', 'e.starts_at'])
      .where('e.id', '=', eventId)
      .executeTakeFirst()
  },

  /** Строки одного закрытого события (ACT-07) по группе и нику. */
  eventRows(
    db: Executor,
    eventId: string,
    classId: number | null,
    limit: number,
  ) {
    let query = db
      .selectFrom('app.event_activity_records as r')
      .innerJoin('app.character_classes as c', 'c.id', 'r.class_id')
      .innerJoin('app.profiles as p', 'p.id', 'r.user_id')
      .select([
        'r.user_id',
        'r.nickname',
        'r.class_id',
        'c.name as class_name',
        'r.group_name',
        'r.is_leader',
        'r.status',
        'p.access_role',
      ])
      .where('r.event_id', '=', eventId)
    if (classId !== null) {
      query = query.where('r.class_id', '=', classId)
    }
    return query
      .orderBy('r.group_name')
      .orderBy('r.nickname')
      .orderBy('r.user_id')
      .limit(limit)
      .execute()
  },

  /** Показатели одного участника за период (ACT-08). */
  async memberStats(
    db: Executor,
    userId: string,
    period: Period,
    classId: number | null,
  ) {
    let query = periodRecords(db, period)
      .select((eb) => [
        eb.fn
          .countAll<string>()
          .filterWhere('r.status', '=', 'visited')
          .as('visited'),
        eb.fn
          .countAll<string>()
          .filterWhere('r.status', '=', 'missed')
          .as('missed'),
        eb.fn
          .countAll<string>()
          .filterWhere('r.status', '=', 'unmarked')
          .as('unmarked'),
        eb.fn.countAll<string>().as('total'),
      ])
      .where('r.user_id', '=', userId)
    if (classId !== null) {
      query = query.where('r.class_id', '=', classId)
    }
    const row = await query.executeTakeFirstOrThrow()
    return {
      visited: Number(row.visited),
      missed: Number(row.missed),
      unmarked: Number(row.unmarked),
      total: Number(row.total),
    }
  },
}

/** Экранирование `%`, `_` и `\` для ILIKE. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
