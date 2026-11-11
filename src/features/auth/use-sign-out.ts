import { useMutation } from '@tanstack/react-query'
import { signOut } from './auth-api'

/**
 * Выход из аккаунта. Кеш запросов очищает `SessionProvider` при смене
 * пользователя; `onBeforeSignOut` — локальная очистка вызывающей стороны.
 */
export function useSignOut(onBeforeSignOut?: () => void | Promise<void>) {
  return useMutation({
    mutationFn: async () => {
      await onBeforeSignOut?.()
      await signOut()
    },
  })
}
