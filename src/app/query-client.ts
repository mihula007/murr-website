import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/toaster'
import { signOutLocally } from '@/features/auth/auth-api'
import { errorMessage, type AppError } from '@/lib/errors'

/**
 * Клиент кеша приложения. Ответ `forbidden` от `api` означает, что роль могла
 * измениться во время сессии (приём, блокировка, смена роли), — профиль `me`
 * перечитывается, и меню с доступом к маршрутам обновляются.
 * `account_deleted` — аккаунт удаляется администратором: локальный выход.
 */
export function createQueryClient() {
  let signingOut = false
  const refreshRoleOnForbidden = (error: AppError) => {
    if (error.code === 'forbidden') {
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    }
    if (error.code === 'account_deleted' && !signingOut) {
      signingOut = true
      toast(errorMessage('account_deleted'))
      void signOutLocally()
        .catch(() => undefined)
        .finally(() => {
          signingOut = false
        })
    }
  }
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: refreshRoleOnForbidden }),
    mutationCache: new MutationCache({ onError: refreshRoleOnForbidden }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
      mutations: { retry: false },
    },
  })
  return queryClient
}
