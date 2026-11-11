import { LIMITS } from '@contracts/account'
import type { ApiErrorCode } from '@contracts/errors'

/** Коды ошибок Supabase Auth, для которых есть понятный текст. */
export const AUTH_ERROR_CODES = [
  'invalid_credentials',
  'email_not_confirmed',
  'user_already_exists',
  'otp_expired',
  'weak_password',
  'same_password',
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'email_address_invalid',
] as const
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number]

/**
 * Единственный тип кода ошибки клиента: коды API, коды Auth, а также
 * `network` (нет связи), `unavailable` (Supabase не настроен) и `unknown`.
 */
export type ClientErrorCode =
  | ApiErrorCode
  | AuthErrorCode
  | 'current_password_wrong'
  | 'network'
  | 'unavailable'
  | 'unknown'

/** Коды ошибок отдельных полей: из zod-схем, сервера и операций Auth. */
export type FieldErrorCode =
  | 'required'
  | 'too_long'
  | 'too_many'
  | 'too_few'
  | 'duplicate'
  | 'locked'
  | 'invalid_date'
  | 'invalid_url'
  | 'nickname_taken'
  | 'profile_exists'
  | 'invalid_email'
  | 'password_short'
  | 'password_mismatch'
  | 'invalid_code'
  | 'current_password_required'

/**
 * Единственная ошибка, которую видит интерфейс. `fields` — ошибки полей:
 * имя поля → код сообщения из каталога.
 */
export class AppError extends Error {
  readonly code: ClientErrorCode
  readonly fields: Record<string, string>

  constructor(code: ClientErrorCode, fields: Record<string, string> = {}) {
    super(code)
    this.name = 'AppError'
    this.code = code
    this.fields = fields
  }
}

// Запросы и изменения TanStack Query отклоняются только `AppError`: адаптеры
// в src/lib/supabase/ и src/features/auth/ нормализуют ошибки через toAppError.
declare module '@tanstack/react-query' {
  interface Register {
    defaultError: AppError
  }
}

/** Единственный каталог сообщений об ошибках (формы и поля). */
const MESSAGES: Record<ClientErrorCode | FieldErrorCode, string> = {
  // API
  not_authenticated: 'Сессия завершилась. Войдите снова.',
  email_not_confirmed: 'Email не подтверждён. Введите код из письма.',
  forbidden: 'Недостаточно прав для этого действия.',
  not_found: 'Не найдено.',
  registration_incomplete: 'Сначала завершите регистрацию.',
  already_bootstrapped: 'Администратор уже назначен.',
  state_conflict:
    'Данные уже изменились. Обновите страницу и попробуйте снова.',
  application_pending:
    'У пользователя есть заявка на рассмотрении: решение принимается в разделе «Заявки».',
  last_admin: 'Нельзя понизить последнего администратора.',
  primary_admin: 'Основного администратора нельзя понизить.',
  validation_failed: 'Проверьте поля формы.',
  avatar_invalid:
    'Аватар не принят: нужен JPEG, PNG или WebP до 500 КБ. Выберите файл ещё раз.',
  internal: 'Сервер не смог выполнить действие. Попробуйте ещё раз позже.',
  // Auth
  invalid_credentials: 'Неверный email или пароль.',
  user_already_exists: 'Аккаунт с этим email уже существует — войдите.',
  otp_expired: 'Неверный или истёкший код. Запросите новый.',
  weak_password: `Пароль слишком простой: нужно не менее ${LIMITS.passwordMin} символов.`,
  same_password: 'Новый пароль должен отличаться от текущего.',
  over_email_send_rate_limit:
    'Слишком много писем. Подождите немного и попробуйте снова.',
  over_request_rate_limit: 'Слишком много попыток. Подождите немного.',
  email_address_invalid: 'Проверьте email.',
  current_password_wrong: 'Текущий пароль указан неверно',
  // Клиент
  network: 'Нет связи с сервером. Проверьте интернет и повторите.',
  unavailable: 'Вход временно недоступен: сервер не подключён.',
  unknown: 'Не удалось выполнить действие. Попробуйте ещё раз.',
  // Поля
  required: 'Заполните поле',
  too_long: 'Слишком длинное значение',
  too_many: 'Слишком много значений',
  too_few: 'Слишком мало значений',
  duplicate: 'Такое значение уже есть',
  locked: 'Это поле нельзя изменить',
  invalid_date: 'Укажите корректную дату',
  invalid_url: 'Нужна ссылка, начинающаяся с http:// или https://',
  nickname_taken: 'Этот ник уже занят',
  profile_exists: 'Профиль уже существует',
  invalid_email: 'Укажите корректный email',
  password_short: `Нужно не менее ${LIMITS.passwordMin} символов`,
  password_mismatch: 'Пароли не совпадают',
  invalid_code: 'Код — 6 цифр из письма',
  current_password_required: 'Введите текущий пароль',
}

function lookup(code: string) {
  return Object.hasOwn(MESSAGES, code)
    ? MESSAGES[code as keyof typeof MESSAGES]
    : undefined
}

/** Текст ошибки всей формы. */
export function errorMessage(code: ClientErrorCode) {
  return lookup(code) ?? MESSAGES.unknown
}

/** Текст ошибки поля по коду из схемы, сервера или Auth. */
export function fieldMessage(code: string) {
  return lookup(code) ?? 'Проверьте значение'
}

/**
 * Сообщение для блока ошибки формы. Ошибки, привязанные к полям, показываются
 * у полей; общий текст остаётся только для `validation_failed`.
 */
export function formErrorMessage(error: AppError | null | undefined) {
  if (!error) {
    return null
  }
  if (
    Object.keys(error.fields).length > 0 &&
    error.code !== 'validation_failed'
  ) {
    return null
  }
  return errorMessage(error.code)
}
