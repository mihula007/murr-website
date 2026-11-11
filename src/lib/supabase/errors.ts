import {
  FunctionsFetchError,
  FunctionsRelayError,
  isAuthError,
} from '@supabase/supabase-js'
import { AppError, AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/errors'

function isKnownAuthCode(code: string | undefined): code is AuthErrorCode {
  return (AUTH_ERROR_CODES as readonly (string | undefined)[]).includes(code)
}

/**
 * Единственный нормализатор ошибок: любую ошибку Supabase SDK, сети или
 * кода превращает в `AppError` с кодом из `ClientErrorCode`. Адаптеры в
 * `src/lib/supabase/` и `src/features/auth/` бросают только `AppError`.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (isAuthError(error)) {
    if (isKnownAuthCode(error.code)) return new AppError(error.code)
    if (error.status === 0) return new AppError('network')
    return new AppError('unknown')
  }
  if (
    error instanceof FunctionsFetchError ||
    error instanceof FunctionsRelayError ||
    error instanceof TypeError
  ) {
    return new AppError('network')
  }
  return new AppError('unknown')
}
