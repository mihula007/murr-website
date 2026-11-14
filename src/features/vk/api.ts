import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VkLinkStart, VkStatus } from '@contracts/vk'
import { callApi } from '@/lib/supabase/api'
import { vkKeys } from './query-keys'

/**
 * Состояние привязки (VK-01): перечитывается при возврате на вкладку —
 * пользователь привязывает аккаунт во ВКонтакте и возвращается на сайт.
 */
export function useVkStatus() {
  return useQuery({
    queryKey: vkKeys.status,
    queryFn: () => callApi<VkStatus>('vk/status'),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

/** Одноразовая ссылка на бота (VK-01). */
export function useStartVkLink() {
  return useMutation({
    mutationFn: () => callApi<VkLinkStart>('vk/link-start'),
  })
}

/** Отвязка (VK-01). */
export function useUnlinkVk() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => callApi<VkStatus>('vk/unlink'),
    onSuccess: (data) => queryClient.setQueryData(vkKeys.status, data),
  })
}
