export type TokenVerifier = (token: string) => Promise<string | null>

/**
 * Проверяет JWT пользователя запросом к Supabase Auth (`/auth/v1/user`) и
 * возвращает его id. Запрос учитывает и отозванные сессии. Без supabase-js,
 * чтобы холодный старт функции оставался лёгким.
 */
export function createTokenVerifier(
  supabaseUrl: string,
  apiKey: string,
): TokenVerifier {
  return async (token) => {
    // Ключ проекта (не JWT) приходит от гостя: это не ошибка, а отсутствие сессии.
    if (token.split('.').length !== 3) {
      return null
    }
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      return null
    }
    const user = (await response.json()) as { id?: unknown }
    return typeof user.id === 'string' && user.id ? user.id : null
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || null
}
