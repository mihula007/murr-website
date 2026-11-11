/** Известные форматы секретов в тексте; значения в сообщения не попадают. */
export function inspectContent(content: string): string[] {
  const findings: string[] = []
  const patterns: [string, RegExp][] = [
    ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,}\b/],
    [
      'GitHub token',
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
    ],
    ['Telegram bot token', /\b\d{8,12}:[A-Za-z0-9_-]{35}\b/],
    ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ]
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) findings.push(name)
  }

  for (const match of content.matchAll(
    /\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g,
  )) {
    try {
      const claims = JSON.parse(
        Buffer.from(match[1] ?? '', 'base64url').toString('utf8'),
      ) as { role?: unknown }
      if (claims.role === 'service_role') {
        findings.push('Supabase service_role JWT')
        break
      }
    } catch {
      // Not a JWT payload. No value is ever included in diagnostic messages.
    }
  }
  return findings
}

/** Шаблон `.env.example`: только имена переменных с пустыми значениями. */
export function inspectTemplate(content: string): string[] {
  const findings: string[] = []
  const names = new Set<string>()
  for (const line of content.split(/\r?\n/)) {
    const entry = line.trim()
    if (!entry || entry.startsWith('#')) continue
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(entry)
    if (!match) {
      findings.push('Некорректная строка шаблона окружения')
      continue
    }
    const name = match[1] ?? ''
    const value = match[2] ?? ''
    if (names.has(name)) findings.push(`Повтор переменной: ${name}`)
    if (value !== '') findings.push(`Значение должно быть пустым: ${name}`)
    names.add(name)
  }
  return findings
}
