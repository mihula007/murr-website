import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { sql } from 'kysely'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { loadActor } from '../../supabase/functions/_shared/auth/actor.ts'
import { createStorageGateway } from '../../supabase/functions/_shared/storage/gateway.ts'
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

export function testDeps(db: Db): AppDeps {
  return {
    db,
    storage: createStorageGateway(env('API_URL'), env('SERVICE_ROLE_KEY')),
    now: () => new Date(),
  }
}

/** PNG 1×1 — минимальное корректное изображение. */
export const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/** Загружает файл в папку пользователя тем же путём, что и браузер. */
export async function uploadAvatar(
  deps: AppDeps,
  userId: string,
  bytes: Uint8Array = PNG_BYTES,
  contentType = 'image/png',
) {
  const path = `${userId}/${randomUUID()}.png`
  const { token } = await deps.storage.createUploadUrl('avatars', path)
  const client = createClient(env('API_URL'), env('ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.storage
    .from('avatars')
    .uploadToSignedUrl(
      path,
      token,
      new Blob([bytes as BlobPart], { type: contentType }),
      {
        contentType,
      },
    )
  if (error) throw error
  return path
}

export function actorOf(db: Db, userId: string) {
  return loadActor(db, userId)
}

export const registration = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'Анна',
  gameNickname: `n${randomUUID().slice(0, 6)}`,
  city: 'Москва',
  birthDate: '1995-04-12',
  classId: 1,
  about: 'Играю давно, хочу в клан.',
  equipmentLinks: ['https://example.com/gear.png'],
  ...overrides,
})
