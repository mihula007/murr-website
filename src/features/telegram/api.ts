import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TelegramLinkStart, TelegramStatus } from '@contracts/telegram'
import { callApi } from '@/lib/supabase/api'
import { telegramKeys } from './query-keys'

/**
 * Состояние привязки (TGM-06): перечитывается при возврате на вкладку —
 * пользователь привязывает аккаунт в Telegram и возвращается на сайт.
 */
export function useTelegramStatus() {
  return useQuery({
    queryKey: telegramKeys.status,
    queryFn: () => callApi<TelegramStatus>('telegram/status'),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  })
}

/** Одноразовая ссылка на бота (TGM-02, TGM-03). */
export function useStartTelegramLink() {
  return useMutation({
    mutationFn: () => callApi<TelegramLinkStart>('telegram/link-start'),
  })
}

/** Отвязка (TGM-07). */
export function useUnlinkTelegram() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => callApi<TelegramStatus>('telegram/unlink'),
    onSuccess: (data) => queryClient.setQueryData(telegramKeys.status, data),
  })
}
