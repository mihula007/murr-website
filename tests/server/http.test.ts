import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createAuthUser,
  createProfiledUser,
  env,
  PNG_BYTES,
  registration,
  resetAppData,
  signIn,
  testDb,
  testDeps,
  uploadAvatar,
} from './support.ts'

const db = testDb()
const deps = testDeps(db)

beforeEach(() => resetAppData(db))
afterAll(() => db.destroy())

async function call(route: string, body: unknown = {}, token?: string) {
  const key = env('ANON_KEY')
  const response = await fetch(`${env('API_URL')}/functions/v1/api/${route}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  }
}

describe('api function over HTTP', () => {
  it('serves the class catalog to a guest', async () => {
    const result = await call('catalog/classes')
    expect(result.status).toBe(200)
    expect(result.body.classes).toHaveLength(17)
  })

  it('rejects closed operations without a session', async () => {
    for (const route of [
      'account/me',
      'account/avatar-upload',
      'account/complete-registration',
      'account/update-profile',
      'applications/list',
      'applications/get',
      'applications/decide',
      'applications/resubmit',
      'notifications/summary',
      'notifications/list',
      'notifications/read',
      'notifications/read-all',
      'notifications/section-seen',
      'roster/stats',
      'roster/list',
      'roster/readers',
      'accounts/list',
      'accounts/set-role',
      'accounts/restore-reader',
      'accounts/get',
      'accounts/set-password',
      'accounts/delete',
      'accounts/deletions',
      'audit/list',
      'broadcasts/prefill',
      'broadcasts/drafts',
      'broadcasts/save-draft',
      'broadcasts/delete-draft',
      'broadcasts/templates',
      'broadcasts/save-template',
      'broadcasts/delete-template',
      'applications/submit-to-vote',
      'applications/final-decide',
      'votes/list',
      'votes/get',
      'votes/create',
      'votes/update',
      'votes/cast',
      'votes/close',
      'votes/delete',
      'events/list',
      'events/get',
      'events/create',
      'events/update',
      'events/delete',
      'events/respond',
      'events/ensure-weekly',
      'events/templates',
      'events/template-save',
      'events/template-delete',
      'events/template-next',
      'events/close',
      'groups/create',
      'groups/rename',
      'groups/delete',
      'groups/move',
      'groups/set-leader',
      'group-templates/list',
      'group-templates/save',
      'group-templates/delete',
      'group-templates/apply',
      'activity/summary',
      'activity/history',
      'activity/events',
      'activity/event',
      'activity/member',
      'activity/rating',
      'activity/month-top',
      'publications/list',
      'publications/get',
      'publications/upload-url',
      'publications/discard-uploads',
      'publications/save',
      'publications/unpublish',
      'publications/delete',
      'market/list',
      'market/get',
      'market/save',
      'market/unpublish',
      'market/delete',
      'discussions/list',
      'discussions/changes',
      'discussions/send',
      'discussions/edit',
      'discussions/react',
      'discussions/mark-read',
      'discussions/readers',
      'discussions/reactions',
    ]) {
      expect(await call(route)).toEqual({
        status: 401,
        body: { error: 'not_authenticated' },
      })
    }
  })

  it('rejects the weekly events call with a wrong schedule secret', async () => {
    const key = env('ANON_KEY')
    const response = await fetch(
      `${env('API_URL')}/functions/v1/api/events/ensure-weekly`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'x-cron-secret': `wrong-${crypto.randomUUID()}`,
        },
        body: '{}',
      },
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'forbidden' })
  })

  it('serves the roster count to a guest', async () => {
    expect(await call('roster/count')).toEqual({
      status: 200,
      body: { count: 0 },
    })
  })

  it('lets members discuss an event and forbids readers over HTTP', async () => {
    const member = await createProfiledUser(db, 'member')
    const reader = await createProfiledUser(db, 'reader')
    const event = await db
      .insertInto('app.events')
      .values({
        title: 'Рейд',
        event_type: 'pve',
        description: 'Описание',
        starts_at: '2030-01-01T17:00:00Z',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    const thread = { parent: 'event', parentId: event.id }
    const memberToken = await signIn(member.email)
    const sent = await call(
      'discussions/send',
      { ...thread, body: 'Привет' },
      memberToken,
    )
    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ body: 'Привет', mine: true })
    const page = await call('discussions/list', thread, memberToken)
    expect(page.body.items).toHaveLength(1)
    const readerToken = await signIn(reader.email)
    for (const route of ['discussions/list', 'discussions/send']) {
      expect(await call(route, { ...thread, body: 'Т' }, readerToken)).toEqual({
        status: 403,
        body: { error: 'forbidden' },
      })
    }
  })

  it('serves the bell to a member and forbids a reader over HTTP', async () => {
    const member = await createProfiledUser(db, 'member')
    const reader = await createProfiledUser(db, 'reader')
    await db
      .insertInto('app.user_notifications')
      .values({
        recipient_id: member.id,
        kind: 'role_changed',
        title: 'Ваша роль изменена',
        source_kind: 'test',
        source_id: '1',
      })
      .execute()
    const memberToken = await signIn(member.email)
    const summary = await call('notifications/summary', {}, memberToken)
    expect(summary).toEqual({
      status: 200,
      body: {
        unreadCount: 1,
        sections: { events: 0, votes: 0, publications: 0, market: 0 },
      },
    })
    const list = await call('notifications/list', {}, memberToken)
    const [item] = list.body.items as { id: string }[]
    expect(
      await call('notifications/read', { id: item!.id }, memberToken),
    ).toEqual({ status: 200, body: { unreadCount: 0 } })
    expect(
      await call(
        'notifications/section-seen',
        { section: 'applications' },
        memberToken,
      ),
    ).toEqual({ status: 403, body: { error: 'forbidden' } })
    const readerToken = await signIn(reader.email)
    for (const route of ['notifications/summary', 'notifications/list']) {
      expect(await call(route, {}, readerToken)).toEqual({
        status: 403,
        body: { error: 'forbidden' },
      })
    }
  })

  it('returns 404 for an unknown route', async () => {
    expect((await call('account/unknown')).status).toBe(404)
  })

  it('completes registration with a real session token', async () => {
    const user = await createAuthUser()
    const token = await signIn(user.email)
    expect((await call('account/me', {}, token)).body).toMatchObject({
      state: 'incomplete',
    })
    expect(await call('account/update-profile', {}, token)).toEqual({
      status: 409,
      body: { error: 'registration_incomplete' },
    })

    const upload = await call(
      'account/avatar-upload',
      { contentType: 'image/png' },
      token,
    )
    expect(upload.status).toBe(200)
    const client = createClient(env('API_URL'), env('ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await client.storage
      .from('avatars')
      .uploadToSignedUrl(
        upload.body.path as string,
        upload.body.token as string,
        new Blob([PNG_BYTES as BlobPart], { type: 'image/png' }),
        { contentType: 'image/png' },
      )
    expect(error).toBeNull()

    const done = await call(
      'account/complete-registration',
      { ...registration(), avatarPath: upload.body.path },
      token,
    )
    expect(done).toMatchObject({ status: 200, body: { state: 'ready' } })
  })

  it('validates the request body and reports field codes', async () => {
    const user = await createAuthUser()
    const token = await signIn(user.email)
    const result = await call(
      'account/complete-registration',
      { ...registration({ gameNickname: '' }), avatarPath: 'x' },
      token,
    )
    expect(result).toMatchObject({
      status: 422,
      body: {
        error: 'validation_failed',
        fields: { gameNickname: 'required' },
      },
    })
  })
})

describe('direct access around the api', () => {
  it('does not expose app tables through the Data API', async () => {
    const user = await createAuthUser()
    const token = await signIn(user.email)
    for (const profile of ['app', 'public']) {
      const response = await fetch(
        `${env('API_URL')}/rest/v1/profiles?select=*`,
        {
          headers: {
            apikey: env('ANON_KEY'),
            Authorization: `Bearer ${token}`,
            'Accept-Profile': profile,
          },
        },
      )
      expect(response.ok).toBe(false)
    }
  })

  it('does not expose user notifications and votes through the Data API', async () => {
    const user = await createAuthUser()
    const token = await signIn(user.email)
    for (const table of [
      'user_notifications',
      'section_views',
      'votes',
      'vote_options',
      'vote_ballots',
      'publications',
      'publication_attachments',
      'market_listings',
      'broadcast_drafts',
      'broadcast_templates',
      'user_deletions',
    ]) {
      const response = await fetch(
        `${env('API_URL')}/rest/v1/${table}?select=*`,
        {
          headers: {
            apikey: env('ANON_KEY'),
            Authorization: `Bearer ${token}`,
            'Accept-Profile': 'app',
          },
        },
      )
      expect(response.ok).toBe(false)
    }
  })

  it('does not let a user read or list avatars directly from Storage', async () => {
    const owner = await createAuthUser()
    const path = await uploadAvatar(deps, owner.id)
    const intruder = await createAuthUser()
    const client = createClient(env('API_URL'), env('ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await client.auth.signInWithPassword({
      email: intruder.email,
      password: 'test-password-1',
    })
    const download = await client.storage.from('avatars').download(path)
    expect(download.data).toBeNull()
    const list = await client.storage.from('avatars').list(owner.id)
    expect(list.data ?? []).toHaveLength(0)
  })

  it('does not let a user read or list publication images directly from Storage', async () => {
    const path = `uploads/${randomUUID()}/1-${randomUUID()}.png`
    const { token } = await deps.storage.createUploadUrl(
      'publication-images',
      path,
    )
    const client = createClient(env('API_URL'), env('ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await client.storage
      .from('publication-images')
      .uploadToSignedUrl(
        path,
        token,
        new Blob([PNG_BYTES], { type: 'image/png' }),
        {
          contentType: 'image/png',
        },
      )
    const reader = await createAuthUser()
    await client.auth.signInWithPassword({
      email: reader.email,
      password: 'test-password-1',
    })
    const download = await client.storage
      .from('publication-images')
      .download(path)
    expect(download.data).toBeNull()
    const list = await client.storage
      .from('publication-images')
      .list(path.split('/').slice(0, 2).join('/'))
    expect(list.data ?? []).toHaveLength(0)
  })
})
