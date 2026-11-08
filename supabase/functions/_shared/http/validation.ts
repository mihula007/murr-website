import type { z } from 'zod'
import { ApiError } from './errors.ts'

/** Разбор тела запроса общей zod-схемой; ошибки полей — коды из схемы. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown) {
  const result = schema.safeParse(body)
  if (result.success) return result.data as z.output<T>
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] ??= issue.message
  }
  throw new ApiError('validation_failed', fields)
}
