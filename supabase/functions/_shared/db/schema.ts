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
  'app.user_notifications': KyselyTable<Generated['user_notifications']>
  'app.votes': KyselyTable<Generated['votes']>
  'app.vote_options': KyselyTable<Generated['vote_options']>
  'app.vote_ballots': KyselyTable<Generated['vote_ballots']>
  'app.events': KyselyTable<Generated['events']>
  'app.event_attendance': KyselyTable<Generated['event_attendance']>
  'app.event_templates': KyselyTable<Generated['event_templates']>
  'app.event_groups': KyselyTable<Generated['event_groups']>
  'app.event_group_members': KyselyTable<Generated['event_group_members']>
  'app.group_templates': KyselyTable<Generated['group_templates']>
  'app.group_template_groups': KyselyTable<Generated['group_template_groups']>
  'app.group_template_members': KyselyTable<Generated['group_template_members']>
  'app.event_activity_records': KyselyTable<Generated['event_activity_records']>
  'app.publications': KyselyTable<Generated['publications']>
  'app.publication_attachments': KyselyTable<
    Generated['publication_attachments']
  >
  'app.market_listings': KyselyTable<Generated['market_listings']>
  'app.discussion_threads': KyselyTable<Generated['discussion_threads']>
  'app.discussion_messages': KyselyTable<Generated['discussion_messages']>
  'app.discussion_reactions': KyselyTable<Generated['discussion_reactions']>
  'app.discussion_reads': KyselyTable<Generated['discussion_reads']>
  'auth.users': AuthUsersTable
}

export type ProfileRow = Database['app']['Tables']['profiles']['Row']
export type { AccessRole } from '../contracts/account.ts'
