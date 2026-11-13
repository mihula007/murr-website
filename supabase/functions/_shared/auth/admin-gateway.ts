/**
 * Auth Admin API через `fetch` с серверным ключом (без supabase-js, чтобы
 * холодный старт функции оставался лёгким). Ключ не покидает сервер.
 */
export type AuthAdminGateway = {
  /** Новый пароль; Auth сам завершает все сеансы пользователя (этап 11). */
  setPassword(userId: string, password: string): Promise<void>
  /** Удаляет пользователя Auth; `not_found` — его уже нет. */
  deleteUser(userId: string): Promise<'deleted' | 'not_found'>
}

export class AuthAdminError extends Error {
  readonly status: number

  constructor(operation: string, status: number) {
    super(`Auth admin ${operation} ${status}`)
    this.status = status
  }
}

export function createAuthAdminGateway(
  supabaseUrl: string,
  serviceKey: string,
): AuthAdminGateway {
  const base = `${supabaseUrl}/auth/v1/admin/users`
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  }
  const path = (userId: string) => `${base}/${encodeURIComponent(userId)}`

  return {
    async setPassword(userId, password) {
      const response = await fetch(path(userId), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ password }),
      })
      // Тело ответа содержит данные пользователя: не читается и не логируется.
      await response.body?.cancel()
      if (!response.ok) {
        throw new AuthAdminError('update', response.status)
      }
    },

    async deleteUser(userId) {
      const response = await fetch(path(userId), { method: 'DELETE', headers })
      await response.body?.cancel()
      if (response.status === 404) {
        return 'not_found'
      }
      if (!response.ok) {
        throw new AuthAdminError('delete', response.status)
      }
      return 'deleted'
    },
  }
}
