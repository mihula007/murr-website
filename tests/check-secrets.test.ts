// @vitest-environment node
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { inspectContent, inspectTemplate } from '../scripts/secret-rules.mjs'

describe('repository secret checks', () => {
  it('detects a server Supabase key in source or built output', () => {
    const credential = ['sb', 'secret', 'a'.repeat(32)].join('_')
    expect(inspectContent(`const token = "${credential}"`)).toContain(
      'Supabase secret key',
    )
  })

  it('detects a legacy service_role JWT', () => {
    const header = Buffer.from('{"alg":"HS256"}').toString('base64url')
    const payload = Buffer.from('{"role":"service_role"}').toString('base64url')
    const credential = `${header}.${payload}.signature`
    expect(inspectContent(credential)).toContain('Supabase service_role JWT')
  })

  it('detects a GitHub personal access token', () => {
    const credential = ['ghp', 'a'.repeat(36)].join('_')
    expect(inspectContent(credential)).toContain('GitHub token')
  })

  it('detects a Telegram bot token', () => {
    const credential = ['123456789', 'a'.repeat(35)].join(':')
    expect(inspectContent(credential)).toContain('Telegram bot token')
  })

  it('permits public Supabase configuration and empty secret placeholders', () => {
    expect(
      inspectContent('VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example'),
    ).toEqual([])
    expect(inspectTemplate('TELEGRAM_BOT_TOKEN=\nMAX_BOT_TOKEN=\n')).toEqual([])
  })

  it('rejects non-empty template values without including them in findings', () => {
    const value = 'a-private-example-value'
    const findings = inspectTemplate(`TELEGRAM_BOT_TOKEN=${value}`)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('TELEGRAM_BOT_TOKEN')
    expect(findings.join(' ')).not.toContain(value)
  })

  it('rejects duplicate template names', () => {
    expect(inspectTemplate('MAX_BOT_TOKEN=\nMAX_BOT_TOKEN=\n')).toHaveLength(1)
  })
})
