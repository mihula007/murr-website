import type { ColumnType } from 'kysely'
import type { Database } from './database.types.ts'

type Generated = Database['app']['Tables']

/** Типы Kysely из сгенерированных Supabase-типов: Row/Insert/Update по колонкам. */
type KyselyTable<T extends Generated[keyof Generated]> = {
  [K in keyof T['Row']]: ColumnType<
    T['Row'][K],
    K extends keyof T['Insert'] ? T['Insert'][K] : never,
    K extends keyof T['Update'] ? T['Update'][K] : never
  >
}

/** Нужные сервисам поля auth.users (только чтение). */
type AuthUsersTable = {
  id: ColumnType<string, never, never>
  email: ColumnType<string | null, never, never>
  email_confirmed_at: ColumnType<string | null, never, never>
}

export type DB = {
  'app.character_classes': KyselyTable<Generated['character_classes']>
  'app.profiles': KyselyTable<Generated['profiles']>
  'app.join_applications': KyselyTable<Generated['join_applications']>
  'app.application_equipment_links': KyselyTable<
    Generated['application_equipment_links']
  >
  'app.audit_log': KyselyTable<Generated['audit_log']>
  'auth.users': AuthUsersTable
}

export type ProfileRow = Database['app']['Tables']['profiles']['Row']
export type AccessRole = ProfileRow['access_role']
