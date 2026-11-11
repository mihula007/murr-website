/** Нарушение уникальности Postgres (23505), при необходимости — конкретного ограничения. */
export function isUniqueViolation(error: unknown, constraint?: string) {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { code, constraint_name } = error as {
    code?: string
    constraint_name?: string
  }
  return code === '23505' && (!constraint || constraint_name === constraint)
}
