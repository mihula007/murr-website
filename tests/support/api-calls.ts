import type { Mock } from 'vitest'

/**
 * Вызовы `api` страницы без опроса шапки (`notifications/*`, Q-66): тесты
 * разделов проверяют только свои запросы.
 */
export function dataCalls(callApi: Mock) {
  return callApi.mock.calls.filter(
    ([route]) => !String(route).startsWith('notifications/'),
  )
}
