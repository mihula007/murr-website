import { z } from 'zod'
import { LIMITS } from '@contracts/account'

/**
 * Схемы полей Auth (email, пароль, код из письма). Сервер их не проверяет —
 * это делает Supabase Auth, — поэтому они живут на клиенте; ограничения
 * берутся из общих `LIMITS`.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'required')
  .pipe(z.email('invalid_email'))

/** Новый пароль: не короче `LIMITS.passwordMin`. */
export const newPasswordSchema = z
  .string()
  .min(LIMITS.passwordMin, 'password_short')

/** Шестизначный код из письма. */
export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'invalid_code')

export const PASSWORD_HINT = `Минимум ${LIMITS.passwordMin} символов`
