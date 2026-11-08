import { Kysely, type Transaction } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import postgres from 'postgres'
import type { DB } from './schema.ts'

export type Db = Kysely<DB>
/** Исполнитель запросов репозитория: подключение или открытая транзакция. */
export type Executor = Kysely<DB> | Transaction<DB>

// Даты и время отдаются строками, как в сгенерированных типах.
const DATE_OIDS = [1082, 1114, 1184]

export function createDb(url: string): Db {
  const sql = postgres(url, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    types: {
      date: {
        to: 1184,
        from: DATE_OIDS,
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
    },
  })
  return new Kysely<DB>({ dialect: new PostgresJSDialect({ postgres: sql }) })
}

/** Единица работы: всё внутри fn фиксируется или откатывается вместе. */
export function withTransaction<T>(
  db: Db,
  fn: (tx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(fn)
}
