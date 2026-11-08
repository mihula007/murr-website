/** Коды ошибок API и HTTP-статусы. Тексты для людей — на клиенте. */
export const API_ERRORS = {
  not_authenticated: 401,
  email_not_confirmed: 403,
  forbidden: 403,
  not_found: 404,
  nickname_taken: 409,
  registration_incomplete: 409,
  already_bootstrapped: 409,
  validation_failed: 422,
  avatar_invalid: 422,
  internal: 500,
} as const

export type ApiErrorCode = keyof typeof API_ERRORS

export type ApiErrorBody = {
  error: ApiErrorCode
  /** Ошибки отдельных полей для validation_failed: поле → код. */
  fields?: Record<string, string>
}
