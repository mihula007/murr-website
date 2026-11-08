/** @param {string} content @returns {string[]} */
export function inspectContent(content) {
  const findings = []
  const patterns = [
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
        Buffer.from(match[1], 'base64url').toString('utf8'),
      )
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

/** @param {string} content @returns {string[]} */
export function inspectTemplate(content) {
  const findings = []
  const names = new Set()
  for (const line of content.split(/\r?\n/)) {
    const entry = line.trim()
    if (!entry || entry.startsWith('#')) continue
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(entry)
    if (!match) {
      findings.push('Некорректная строка шаблона окружения')
      continue
    }
    const [, name, value] = match
    if (names.has(name)) findings.push(`Повтор переменной: ${name}`)
    if (value !== '') findings.push(`Значение должно быть пустым: ${name}`)
    names.add(name)
  }
  return findings
}
