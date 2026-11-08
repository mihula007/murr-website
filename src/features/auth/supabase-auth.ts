import { AuthError } from '@supabase/supabase-js'
import { ApiCallError } from '@/lib/api/client'
import { getSupabaseClient } from '@/lib/supabase/client'

export function requireSupabase() {
  const client = getSupabaseClient()
  if (!client) throw new ApiCallError('unavailable')
  return client
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Неверный email или пароль.',
  email_not_confirmed: 'Email не подтверждён. Введите код из письма.',
  user_already_exists: 'Аккаунт с этим email уже существует — войдите.',
  otp_expired: 'Неверный или истёкший код. Запросите новый.',
  weak_password: 'Пароль слишком простой: нужно не менее 8 символов.',
  same_password: 'Новый пароль должен отличаться от текущего.',
  over_email_send_rate_limit:
    'Слишком много писем. Подождите немного и попробуйте снова.',
  over_request_rate_limit: 'Слишком много попыток. Подождите немного.',
  email_address_invalid: 'Проверьте email.',
}

/** Понятное сообщение для ошибки Supabase Auth без технических деталей. */
export function authErrorMessage(error: unknown) {
  if (error instanceof AuthError && error.code && AUTH_MESSAGES[error.code]) {
    return AUTH_MESSAGES[error.code] as string
  }
  if (error instanceof AuthError && error.status === 0) {
    return 'Нет связи с сервером. Проверьте интернет и повторите.'
  }
  return 'Не удалось выполнить действие. Попробуйте ещё раз.'
}

export function authErrorCode(error: unknown) {
  return error instanceof AuthError ? error.code : undefined
}
