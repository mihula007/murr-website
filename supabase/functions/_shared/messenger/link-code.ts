/**
 * Одноразовый код привязки мессенджера (TGM-02, TGM-03, MAX-01) и проверка
 * секрета вебхука. Общие для Telegram и MAX.
 */

/** 32 случайных байта в base64url — 43 символа (лимиты `start`: 64 и 128). */
export function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** В БД хранится только SHA-256 кода (hex). */
export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Сравнение секрета за время, не зависящее от совпавшего префикса. */
export function sameSecret(given: string, expected: string) {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) {
    diff |= (a[i] ?? 0) ^ b[i]!
  }
  return diff === 0
}
