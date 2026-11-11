// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = readFileSync('supabase/config.toml', 'utf8')

function section(name: string) {
  const start = config.indexOf(`[${name}]\n`)
  if (start === -1) {
    throw new Error(`Нет секции [${name}]`)
  }
  const rest = config.slice(start + name.length + 3)
  const end = rest.search(/^\[/m)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('local Supabase configuration', () => {
  it('confirms email with a six-digit code', () => {
    const email = section('auth.email')
    expect(email).toMatch(/^enable_confirmations = true$/m)
    expect(email).toMatch(/^otp_length = 6$/m)
    expect(section('auth')).toMatch(/^minimum_password_length = 8$/m)
  })

  it('keeps Resend SMTP disabled and takes every credential from env()', () => {
    const smtp = section('auth.email.smtp')
    expect(smtp).toMatch(/^enabled = false$/m)
    for (const key of ['host', 'user', 'pass', 'admin_email', 'sender_name']) {
      expect(smtp).toMatch(
        new RegExp(`^${key} = "env\\(AUTH_SMTP_[A-Z_]+\\)"$`, 'm'),
      )
    }
  })

  it('email templates show the code and contain no links', () => {
    for (const name of ['confirmation', 'recovery']) {
      const html = readFileSync(`supabase/templates/${name}.html`, 'utf8')
      expect(html).toContain('{{ .Token }}')
      expect(html).not.toMatch(/ConfirmationURL|<a\s/i)
    }
  })

  it('keeps the avatars bucket private and limited to 500 KB images', () => {
    const bucket = section('storage.buckets.avatars')
    expect(bucket).toMatch(/^public = false$/m)
    expect(bucket).toMatch(/^file_size_limit = "500KiB"$/m)
    expect(bucket).toContain('"image/jpeg", "image/png", "image/webp"')
  })

  it('exposes only the public schema through the Data API', () => {
    expect(section('api')).toMatch(/^schemas = \["public"\]$/m)
  })
})

describe('browser session lifetime (Q-35)', () => {
  it('refreshes sessions without a time box or inactivity timeout', () => {
    const auth = section('auth')
    expect(auth).toMatch(/^enable_refresh_token_rotation = true$/m)
    expect(config).not.toMatch(/^\[auth\.sessions\]/m)
    expect(config).not.toMatch(/^(timebox|inactivity_timeout) =/m)
  })
})
