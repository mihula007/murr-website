/** Коды ошибок API и HTTP-статусы. Тексты для людей — на клиенте. */
export const API_ERRORS = {
  not_authenticated: 401,
  email_not_confirmed: 403,
  forbidden: 403,
  not_found: 404,
  registration_incomplete: 409,
  already_bootstrapped: 409,
  /** Объект уже изменён другим действием (заявка решена, роль сменилась). */
  state_conflict: 409,
  /** Роль кандидата с активной заявкой меняется только решением по заявке. */
  application_pending: 409,
  /** Нельзя понизить последнего администратора (ACL-07, ADM-06). */
  last_admin: 409,
  /** Нельзя понизить основного администратора (ACL-07, ADM-06). */
  primary_admin: 409,
  validation_failed: 422,
  avatar_invalid: 422,
  /** Вложение публикации не прошло проверку типа, размера или владельца. */
  publication_file_invalid: 422,
  internal: 500,
} as const

export type ApiErrorCode = keyof typeof API_ERRORS

export type ApiErrorBody = {
  error: ApiErrorCode
  /** Ошибки отдельных полей для validation_failed: поле → код. */
  fields?: Record<string, string>
}
