import { describe, expect, it } from 'vitest'
import { readSupabaseConfig } from '@/lib/supabase/config'

describe('public Supabase configuration', () => {
  const publicKey = 'sb_publishable_example'
  const projectUrl = 'https://example.supabase.co'

  it('allows the static application to start without a backend', () => {
    expect(readSupabaseConfig({})).toBeNull()
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
      }),
    ).toBeNull()
  })

  it('accepts a complete public configuration', () => {
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: projectUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
      }),
    ).toEqual({ url: projectUrl, publishableKey: publicKey })
  })

  it.each([
    { VITE_SUPABASE_URL: projectUrl },
    { VITE_SUPABASE_PUBLISHABLE_KEY: publicKey },
  ])('rejects an incomplete configuration', (env) => {
    expect(() => readSupabaseConfig(env)).toThrow('обе переменные')
  })

  it.each(['not-a-url', 'javascript:alert(1)', 'http://example.supabase.co'])(
    'rejects an unsafe URL: %s',
    (url) => {
      expect(() =>
        readSupabaseConfig({
          VITE_SUPABASE_URL: url,
          VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
        }),
      ).toThrow('URL Supabase')
    },
  )

  it.each(['http://127.0.0.1:54321', 'http://localhost:54321'])(
    'allows local Supabase over HTTP: %s',
    (url) => {
      expect(
        readSupabaseConfig({
          VITE_SUPABASE_URL: url,
          VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
        })?.url,
      ).toBe(url)
    },
  )

  it.each(['sb_' + 'secret_canary', 'eyJhbGciOiJIUzI1NiJ9.example.signature'])(
    'rejects non-publishable keys without echoing their value',
    (key) => {
      const read = () =>
        readSupabaseConfig({
          VITE_SUPABASE_URL: projectUrl,
          VITE_SUPABASE_PUBLISHABLE_KEY: key,
        })

      expect(read).toThrow('publishable key')
      expect(read).not.toThrow(key)
    },
  )
})
