import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createAuthUser,
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
      'roster/stats',
      'roster/list',
      'roster/readers',
      'accounts/list',
      'accounts/set-role',
      'accounts/restore-reader',
    ]) {
      expect(await call(route)).toEqual({
        status: 401,
        body: { error: 'not_authenticated' },
      })
    }
  })

  it('serves the roster count to a guest', async () => {
    expect(await call('roster/count')).toEqual({
      status: 200,
      body: { count: 0 },
    })
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

  it('does not expose user notifications through the Data API', async () => {
    const user = await createAuthUser()
    const token = await signIn(user.email)
    const response = await fetch(
      `${env('API_URL')}/rest/v1/user_notifications?select=*`,
      {
        headers: {
          apikey: env('ANON_KEY'),
          Authorization: `Bearer ${token}`,
          'Accept-Profile': 'app',
        },
      },
    )
    expect(response.ok).toBe(false)
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
})
