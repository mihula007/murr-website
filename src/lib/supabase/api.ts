import { FunctionsHttpError } from '@supabase/supabase-js'
import type { ApiErrorBody } from '@contracts/errors'
import { AppError } from '@/lib/errors'
import { requireSupabase } from './client'
import { toAppError } from './errors'

/**
 * Вызов операции функции `api`, например `account/me`. Ошибка никогда не
 * выдаётся за успех и всегда приходит как `AppError`.
 */
export async function callApi<T>(route: string, body: object = {}): Promise<T> {
  const supabase = requireSupabase()
  const { data, error } = await supabase.functions
    .invoke<T>(`api/${route}`, { body })
    .catch((thrown: unknown) => {
      throw toAppError(thrown)
    })
  if (!error) {
    return data as T
  }
  if (error instanceof FunctionsHttpError) {
    const payload = (await (error.context as Response)
      .json()
      .catch(() => null)) as ApiErrorBody | null
    throw new AppError(payload?.error ?? 'internal', payload?.fields)
  }
  throw toAppError(error)
}
