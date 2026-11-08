import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { sql } from 'kysely'
import {
  createDb,
  type Db,
} from '../../supabase/functions/_shared/db/client.ts'
import type { AccessRole } from '../../supabase/functions/_shared/db/schema.ts'

export function env(name: string) {
  const value = process.env[`LOCAL_${name}`]
  if (!value) throw new Error(`Нет LOCAL_${name}: запустите локальный Supabase`)
  return value
}

export function testDb(): Db {
  return createDb(env('DB_URL'))
}

export function adminClient() {
  return createClient(env('API_URL'), env('SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Очищает прикладные данные; справочник классов остаётся. */
export async function resetAppData(db: Db) {
  await sql`truncate app.audit_log, app.application_equipment_links,
    app.join_applications, app.profiles restart identity cascade`.execute(db)
}

export const TEST_PASSWORD = 'test-password-1'

export async function createAuthUser(options: { confirmed?: boolean } = {}) {
  const email = `user-${randomUUID()}@example.test`
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: options.confirmed ?? true,
  })
  if (error || !data.user) throw error ?? new Error('Не создан пользователь')
  return { id: data.user.id, email }
}

let nicknameCounter = 0

/** Пользователь с профилем нужной роли (вставка в обход сервиса — фикстура). */
export async function createProfiledUser(db: Db, role: AccessRole) {
  const user = await createAuthUser()
  nicknameCounter += 1
  const nickname = `u${nicknameCounter}${randomUUID().slice(0, 4)}`
  await db
    .insertInto('app.profiles')
    .values({
      id: user.id,
      display_name: 'Тест',
      game_nickname: nickname,
      class_id: 1,
      access_role: role,
      is_primary_admin: false,
    })
    .execute()
  return { ...user, nickname }
}

export async function signIn(email: string, password = TEST_PASSWORD) {
  const client = createClient(env('API_URL'), env('ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.session) throw error ?? new Error('Нет сессии')
  return data.session.access_token
}
