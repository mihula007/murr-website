import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Kysely } from 'kysely'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { setRole } from '../../supabase/functions/_shared/accounts/service.ts'
import type { AppDeps } from '../../supabase/functions/_shared/app.ts'
import { submitApplicationToVote } from '../../supabase/functions/_shared/applications/service.ts'
import { applicationRepository } from '../../supabase/functions/_shared/applications/repository.ts'
import {
  GUEST,
  requireUser,
} from '../../supabase/functions/_shared/auth/actor.ts'
import {
  saveBroadcastTemplate,
  saveDraft,
} from '../../supabase/functions/_shared/broadcasts/service.ts'
import type { AccessRole } from '../../supabase/functions/_shared/contracts/account.ts'
import type { DB } from '../../supabase/functions/_shared/db/schema.ts'
import {
  deleteAccount,
  pendingDeletions,
} from '../../supabase/functions/_shared/deletion/service.ts'
import {
  closeEvent,
  createEvent,
  respondToEvent,
  saveTemplate,
} from '../../supabase/functions/_shared/events/service.ts'
import {
  createGroup,
  moveMember,
  setGroupLeader,
} from '../../supabase/functions/_shared/groups/service.ts'
import {
  castBallot,
  createVote,
} from '../../supabase/functions/_shared/votes/service.ts'
import {
  actorOf,
  createProfiledUser,
  env,
  PNG_BYTES,
  resetAppData,
  testDb,
  testDeps,
  uploadAvatar,
} from './support.ts'

const db = testDb()
const deps: AppDeps = testDeps(db)

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code })

async function roleActor(role: AccessRole) {
  const user = await createProfiledUser(db, role)
  return { user, actor: await actorOf(db, user.id) }
}

const eventFields = {
  title: 'Рейд',
  type: 'pve',
  date: '2099-11-14',
  time: '20:00',
  description: 'Сбор у портала',
}

const doc = { type: 'doc', content: [] }

/** Файл в bucket публикаций по пути (как загрузка браузера). */
async function uploadPublicationFile(path: string) {
  const { token } = await deps.storage.createUploadUrl(
    'publication-images',
    path,
  )
  const client = createClient(env('API_URL'), env('ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.storage
    .from('publication-images')
    .uploadToSignedUrl(
      path,
      token,
      new Blob([PNG_BYTES as BlobPart], { type: 'image/png' }),
      { contentType: 'image/png' },
    )
  if (error) {
    throw error
  }
}

async function count(
  table: keyof DB & `app.${string}`,
  column: string,
  value: string,
) {
  const row = await db
    .selectFrom(table as 'app.profiles')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where(column as 'id', '=', value)
    .executeTakeFirstOrThrow()
  return Number(row.count)
}

async function authUserExists(id: string) {
  const row = await db
    .selectFrom('auth.users')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst()
  return !!row
}

/**
 * Офицер со всеми видами связанных данных и окружение из других участников.
 * Возвращает идентификаторы того, что должно сохраниться или исчезнуть.
 */
async function populate() {
  const admin = await roleActor('admin')
  const victim = await roleActor('officer')
  const other = await roleActor('officer')
  const member = await roleActor('member')
  const id = victim.user.id

  // Аудит до удаления: прежняя запись с исполнителем-жертвой.
  await saveDraft(deps, victim.actor, { body: 'Черновик', channels: ['vk'] })
  await saveBroadcastTemplate(deps, victim.actor, {
    name: 'Мой шаблон',
    body: 'Текст',
    channels: ['vk'],
  })
  await saveTemplate(deps, victim.actor, eventFields)
  await db
    .insertInto('app.group_templates')
    .values({ name: 'Шаблон групп', created_by: id })
    .execute()

  // Аватар и брошенная загрузка.
  const avatarPath = await uploadAvatar(deps, id)
  await db
    .updateTable('app.profiles')
    .set({ avatar_path: avatarPath })
    .where('id', '=', id)
    .execute()
  await uploadPublicationFile(`uploads/${id}/${Date.now()}-${randomUUID()}.png`)

  // Свои событие и голосование сохраняются без автора.
  const ownEvent = await createEvent(deps, victim.actor, eventFields)
  const ownVote = await createVote(deps, victim.actor, {
    title: 'Своё',
    context: '',
    options: ['Да', 'Нет'],
  })

  // Чужое событие: ответ, группа с лидерством, закрытие с итогом.
  const foreignEvent = await createEvent(deps, other.actor, eventFields)
  await respondToEvent(deps, victim.actor, {
    eventId: foreignEvent.id,
    answer: 'yes',
  })
  const { groups } = await createGroup(deps, other.actor, {
    eventId: foreignEvent.id,
    name: 'Пати',
  })
  const groupId = groups[0]!.id
  for (const user of [victim, member]) {
    await moveMember(deps, other.actor, {
      eventId: foreignEvent.id,
      userId: user.user.id,
      groupId,
    })
  }
  await setGroupLeader(deps, other.actor, { groupId, userId: id })
  await closeEvent(deps, other.actor, { id: foreignEvent.id })
  // Активное чужое событие с группой: назначение удаляется.
  const activeEvent = await createEvent(deps, other.actor, eventFields)
  const active = await createGroup(deps, other.actor, {
    eventId: activeEvent.id,
    name: 'Пати 2',
  })
  await moveMember(deps, other.actor, {
    eventId: activeEvent.id,
    userId: id,
    groupId: active.groups[0]!.id,
  })
  await setGroupLeader(deps, other.actor, {
    groupId: active.groups[0]!.id,
    userId: id,
  })

  // Голос в чужом голосовании сохраняется обезличенно.
  const foreignVote = await createVote(deps, other.actor, {
    title: 'Чужое',
    context: '',
    options: ['А', 'Б'],
  })
  await castBallot(deps, victim.actor, {
    voteId: foreignVote.id,
    optionId: foreignVote.options[0]!.id,
  })

  // Публикации: опубликованная с вложением сохраняется, черновик удаляется.
  const published = await db
    .insertInto('app.publications')
    .values({
      category: 'news',
      title: 'Новость',
      content: doc,
      search_text: 'новость',
      excerpt: '',
      status: 'published',
      author_id: id,
      published_at: new Date().toISOString(),
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  await db
    .insertInto('app.publication_attachments')
    .values({
      publication_id: published.id,
      path: `publications/${published.id}/kept.png`,
      file_name: 'kept.png',
      size: 10,
      content_type: 'image/png',
      position: 0,
    })
    .execute()
  const draft = await db
    .insertInto('app.publications')
    .values({
      category: 'news',
      title: 'Черновик',
      content: doc,
      search_text: 'черновик',
      excerpt: '',
      status: 'draft',
      author_id: id,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  const draftFile = `publications/${draft.id}/${randomUUID()}.png`
  await uploadPublicationFile(draftFile)
  await db
    .insertInto('app.publication_attachments')
    .values({
      publication_id: draft.id,
      path: draftFile,
      file_name: 'draft.png',
      size: 10,
      content_type: 'image/png',
      position: 0,
    })
    .execute()
  for (const status of ['published', 'draft'] as const) {
    await db
      .insertInto('app.market_listings')
      .values({
        category: 'sale',
        title: status,
        content: doc,
        search_text: status,
        excerpt: '',
        status,
        author_id: id,
        published_at: status === 'published' ? new Date().toISOString() : null,
      })
      .execute()
  }

  // Обсуждение: сообщение, реакция, прочтение.
  const thread = await db
    .insertInto('app.discussion_threads')
    .values({ event_id: activeEvent.id })
    .returning('id')
    .executeTakeFirstOrThrow()
  const message = await db
    .insertInto('app.discussion_messages')
    .values({ thread_id: thread.id, author_id: id, body: 'Привет' })
    .returning('id')
    .executeTakeFirstOrThrow()
  await db
    .insertInto('app.discussion_reactions')
    .values({ message_id: message.id, user_id: id, emoji: '👍' })
    .execute()
  await db
    .insertInto('app.discussion_reads')
    .values({
      thread_id: thread.id,
      user_id: id,
      read_up_to: new Date().toISOString(),
    })
    .execute()

  // Уведомления: свои удаляются, вызванные жертвой у других остаются.
  await db
    .insertInto('app.user_notifications')
    .values([
      {
        recipient_id: id,
        kind: 'role_changed',
        title: 'Себе',
        source_kind: 's',
        source_id: '1',
      },
      {
        recipient_id: member.user.id,
        actor_id: id,
        kind: 'role_changed',
        title: 'Другому',
        source_kind: 's',
        source_id: '2',
      },
    ])
    .execute()
  await db
    .insertInto('app.section_views')
    .values({
      user_id: id,
      section: 'events',
      seen_at: new Date().toISOString(),
    })
    .execute()

  return {
    admin,
    victim,
    other,
    member,
    avatarPath,
    ownEvent,
    ownVote,
    foreignEvent,
    foreignVote,
    published: published.id,
    draft: draft.id,
    draftFile,
    message: message.id,
  }
}

describe('user deletion: access (Q-73, ACL-03, ACL-07)', () => {
  it('allows only an admin to delete a non-admin other than self', async () => {
    const admin = await roleActor('admin')
    const otherAdmin = await roleActor('admin')
    const target = await roleActor('member')
    const request = {
      userId: target.user.id,
      confirmNickname: target.user.nickname,
    }
    await rejects(deleteAccount(deps, GUEST, request), 'not_authenticated')
    for (const role of ['applicant', 'reader', 'member', 'officer'] as const) {
      const { actor } = await roleActor(role)
      await rejects(deleteAccount(deps, actor, request), 'forbidden')
      await rejects(pendingDeletions(deps, actor), 'forbidden')
    }
    await rejects(
      deleteAccount(deps, admin.actor, {
        userId: admin.user.id,
        confirmNickname: admin.user.nickname,
      }),
      'forbidden',
    )
    await rejects(
      deleteAccount(deps, admin.actor, {
        userId: otherAdmin.user.id,
        confirmNickname: otherAdmin.user.nickname,
      }),
      'forbidden',
    )
    await expect(
      deleteAccount(deps, admin.actor, { ...request, confirmNickname: 'нет' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { confirmNickname: 'nickname_mismatch' },
    })
    expect(await count('app.profiles', 'id', target.user.id)).toBe(1)
    expect((await pendingDeletions(deps, admin.actor)).items).toEqual([])
  })
})

describe('user deletion: data rules (ADM-08, table of stage 11)', () => {
  it('removes personal data, keeps shared objects and writes one audit record', async () => {
    const data = await populate()
    const id = data.victim.user.id
    const auditBefore = await db
      .selectFrom('app.audit_log')
      .select('id')
      .where('actor_id', '=', id)
      .execute()
    expect(auditBefore.length).toBeGreaterThan(0)

    await deleteAccount(deps, data.admin.actor, {
      userId: id,
      confirmNickname: data.victim.user.nickname,
    })

    // Профиль, Auth и служебная запись.
    expect(await count('app.profiles', 'id', id)).toBe(0)
    expect(await authUserExists(id)).toBe(false)
    expect(await count('app.user_deletions', 'user_id', id)).toBe(0)
    // Личные записи удалены.
    for (const [table, column] of [
      ['app.event_attendance', 'user_id'],
      ['app.event_group_members', 'user_id'],
      ['app.event_activity_records', 'user_id'],
      ['app.event_templates', 'created_by'],
      ['app.group_templates', 'created_by'],
      ['app.broadcast_drafts', 'author_id'],
      ['app.broadcast_templates', 'author_id'],
      ['app.user_notifications', 'recipient_id'],
      ['app.section_views', 'user_id'],
      ['app.discussion_reads', 'user_id'],
    ] as const) {
      expect(await count(table, column, id), table).toBe(0)
    }
    expect(await count('app.publications', 'id', data.draft)).toBe(0)
    // Сохраняемое — без автора.
    const event = await db
      .selectFrom('app.events')
      .select('created_by')
      .where('id', '=', data.ownEvent.id)
      .executeTakeFirstOrThrow()
    expect(event.created_by).toBeNull()
    const vote = await db
      .selectFrom('app.votes')
      .select('created_by')
      .where('id', '=', data.ownVote.id)
      .executeTakeFirstOrThrow()
    expect(vote.created_by).toBeNull()
    const publication = await db
      .selectFrom('app.publications')
      .select('author_id')
      .where('id', '=', data.published)
      .executeTakeFirstOrThrow()
    expect(publication.author_id).toBeNull()
    expect(
      await count(
        'app.publication_attachments',
        'publication_id',
        data.published,
      ),
    ).toBe(1)
    const listings = await db
      .selectFrom('app.market_listings')
      .select(['status', 'author_id'])
      .execute()
    expect(listings).toEqual([{ status: 'published', author_id: null }])
    const message = await db
      .selectFrom('app.discussion_messages')
      .select('author_id')
      .where('id', '=', data.message)
      .executeTakeFirstOrThrow()
    expect(message.author_id).toBeNull()
    // Обезличенные голос и реакция.
    const ballots = await db
      .selectFrom('app.vote_ballots')
      .select('voter_id')
      .where('vote_id', '=', data.foreignVote.id)
      .execute()
    expect(ballots).toEqual([{ voter_id: null }])
    const reactions = await db
      .selectFrom('app.discussion_reactions')
      .select('user_id')
      .where('message_id', '=', data.message)
      .execute()
    expect(reactions).toEqual([{ user_id: null }])
    // Данные других участников события сохранены, итог пересчитан без жертвы.
    expect(
      await count('app.event_activity_records', 'user_id', data.member.user.id),
    ).toBe(1)
    const notice = await db
      .selectFrom('app.user_notifications')
      .select('actor_id')
      .where('recipient_id', '=', data.member.user.id)
      .where('title', '=', 'Другому')
      .executeTakeFirstOrThrow()
    expect(notice.actor_id).toBeNull()
    // Аудит: прежние записи без связи, но с ником и email; одна запись удаления.
    const previous = await db
      .selectFrom('app.audit_log')
      .select(['actor_id', 'actor_nickname', 'actor_email'])
      .where(
        'id',
        'in',
        auditBefore.map((row) => row.id),
      )
      .execute()
    for (const row of previous) {
      expect(row).toEqual({
        actor_id: null,
        actor_nickname: data.victim.user.nickname,
        actor_email: data.victim.user.email,
      })
    }
    const deletion = await db
      .selectFrom('app.audit_log')
      .selectAll()
      .where('action', '=', 'user_deleted')
      .execute()
    expect(deletion).toHaveLength(1)
    expect(deletion[0]).toMatchObject({
      actor_id: data.admin.user.id,
      target_user_id: null,
      target_nickname: data.victim.user.nickname,
      target_email: data.victim.user.email,
    })
    // Файлы: аватар, загрузки и вложения черновика удалены.
    expect(await deps.storage.list('avatars', id)).toEqual([])
    expect(
      await deps.storage.list('publication-images', `uploads/${id}`),
    ).toEqual([])
    expect(
      await deps.storage.read('publication-images', data.draftFile),
    ).toBeNull()
  })

  it('deletes an applicant with the application and its vote (APP-15)', async () => {
    const admin = await roleActor('admin')
    const officer = await roleActor('officer')
    const member = await roleActor('member')
    const applicant = await roleActor('applicant')
    const applicationId = await applicationRepository.create(
      db,
      applicant.user.id,
      ['https://example.com/gear.png'],
    )
    await submitApplicationToVote(deps, officer.actor, { id: applicationId })
    const vote = await db
      .selectFrom('app.votes')
      .select('id')
      .where('application_id', '=', applicationId)
      .executeTakeFirstOrThrow()
    const options = await db
      .selectFrom('app.vote_options')
      .select('id')
      .where('vote_id', '=', vote.id)
      .execute()
    await castBallot(deps, member.actor, {
      voteId: vote.id,
      optionId: options[0]!.id,
    })

    await deleteAccount(deps, admin.actor, {
      userId: applicant.user.id,
      confirmNickname: applicant.user.nickname,
    })

    expect(await count('app.join_applications', 'id', applicationId)).toBe(0)
    expect(await count('app.votes', 'id', vote.id)).toBe(0)
    expect(await count('app.vote_ballots', 'vote_id', vote.id)).toBe(0)
  })
})

describe('user deletion: failures and retry (Q-74, Q-75)', () => {
  it('stops after a Storage failure, blocks access, and the retry completes', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    const avatar = await uploadAvatar(deps, target.user.id)
    const failing: AppDeps = {
      ...deps,
      storage: {
        ...deps.storage,
        remove: () => Promise.reject(new Error('storage down')),
      },
    }
    const request = {
      userId: target.user.id,
      confirmNickname: target.user.nickname,
    }
    await expect(
      deleteAccount(failing, admin.actor, request),
    ).rejects.toMatchObject({
      code: 'deletion_incomplete',
      fields: { stage: 'files' },
    })
    expect(await count('app.profiles', 'id', target.user.id)).toBe(1)
    const pending = await pendingDeletions(deps, admin.actor)
    expect(pending.items).toEqual([
      expect.objectContaining({
        userId: target.user.id,
        nickname: target.user.nickname,
        stage: 'files',
        lastError: 'files_failed',
      }),
    ])
    // Доступ закрыт; роль сменить нельзя.
    const blocked = await actorOf(db, target.user.id)
    expect(blocked.kind).toBe('deleted')
    expect(() => requireUser(blocked)).toThrow(
      expect.objectContaining({ code: 'account_deleted' }),
    )
    await rejects(
      setRole(deps, admin.actor, { userId: target.user.id, role: 'admin' }),
      'state_conflict',
    )
    expect(await deps.storage.read('avatars', avatar)).not.toBeNull()

    await deleteAccount(deps, admin.actor, request)
    expect(await count('app.profiles', 'id', target.user.id)).toBe(0)
    expect(await authUserExists(target.user.id)).toBe(false)
    expect((await pendingDeletions(deps, admin.actor)).items).toEqual([])
  })

  it('rolls back the database stage entirely and retries without a second audit', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('officer')
    await createEvent(deps, target.actor, eventFields)
    // Транзакция этапа БД выполняет все изменения и падает до фиксации.
    let transactions = 0
    const failingDb = new Proxy(db, {
      get(real, key, receiver) {
        if (key !== 'transaction') {
          return Reflect.get(real, key, receiver)
        }
        return () => {
          transactions += 1
          const builder = real.transaction()
          if (transactions !== 3) {
            return builder
          }
          return {
            execute: (fn: (tx: unknown) => Promise<unknown>) =>
              builder.execute(async (tx) => {
                await fn(tx)
                throw new Error('commit lost')
              }),
          }
        }
      },
    }) as Kysely<DB>
    const request = {
      userId: target.user.id,
      confirmNickname: target.user.nickname,
    }
    await expect(
      deleteAccount({ ...deps, db: failingDb }, admin.actor, request),
    ).rejects.toMatchObject({
      code: 'deletion_incomplete',
      fields: { stage: 'database' },
    })
    expect(await count('app.profiles', 'id', target.user.id)).toBe(1)
    expect(await count('app.events', 'created_by', target.user.id)).toBe(1)
    const audit = () =>
      db
        .selectFrom('app.audit_log')
        .select('id')
        .where('action', '=', 'user_deleted')
        .execute()
    expect(await audit()).toHaveLength(0)

    await deleteAccount(deps, admin.actor, request)
    expect(await count('app.profiles', 'id', target.user.id)).toBe(0)
    expect(await audit()).toHaveLength(1)
  })

  it('keeps access closed when Auth fails after the database, then finishes', async () => {
    const admin = await roleActor('admin')
    const target = await roleActor('member')
    const failing: AppDeps = {
      ...deps,
      authAdmin: {
        ...deps.authAdmin,
        deleteUser: () => Promise.reject(new Error('auth down')),
      },
    }
    const request = {
      userId: target.user.id,
      confirmNickname: target.user.nickname,
    }
    await expect(
      deleteAccount(failing, admin.actor, request),
    ).rejects.toMatchObject({
      code: 'deletion_incomplete',
      fields: { stage: 'auth' },
    })
    expect(await count('app.profiles', 'id', target.user.id)).toBe(0)
    expect(await authUserExists(target.user.id)).toBe(true)
    // Профиля нет, но это не «незавершённая регистрация».
    const blocked = await actorOf(db, target.user.id)
    expect(blocked.kind).toBe('deleted')

    // Повтор по снимку ника, параллельно — без дублей аудита.
    await Promise.all([
      deleteAccount(deps, admin.actor, request),
      deleteAccount(deps, admin.actor, request).catch(() => undefined),
    ])
    expect(await authUserExists(target.user.id)).toBe(false)
    expect(await count('app.user_deletions', 'user_id', target.user.id)).toBe(0)
    const audit = await db
      .selectFrom('app.audit_log')
      .select('id')
      .where('action', '=', 'user_deleted')
      .execute()
    expect(audit).toHaveLength(1)
    expect((await actorOf(db, target.user.id)).kind).toBe('guest')
  })
})
