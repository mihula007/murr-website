import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import type { AppError } from '@/lib/errors'

/**
 * Клиент кеша приложения. Ответ `forbidden` от `api` означает, что роль могла
 * измениться во время сессии (приём, блокировка, смена роли), — профиль `me`
 * перечитывается, и меню с доступом к маршрутам обновляются.
 */
export function createQueryClient() {
  const refreshRoleOnForbidden = (error: AppError) => {
    if (error.code === 'forbidden') {
      void queryClient.invalidateQueries({ queryKey: ['me'] })
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
