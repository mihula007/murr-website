import { createClient } from '@supabase/supabase-js'

export type TokenVerifier = (token: string) => Promise<string | null>

/** Проверяет JWT пользователя через Supabase Auth и возвращает его id. */
export function createTokenVerifier(
  supabaseUrl: string,
  apiKey: string,
): TokenVerifier {
  const client = createClient(supabaseUrl, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return async (token) => {
    // Ключ проекта (не JWT) приходит от гостя: это не ошибка, а отсутствие сессии.
    if (token.split('.').length !== 3) return null
    const { data, error } = await client.auth.getClaims(token)
    if (error || !data) return null
    const sub = data.claims.sub
    return typeof sub === 'string' && sub ? sub : null
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || null
}
