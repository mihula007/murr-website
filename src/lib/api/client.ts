import { FunctionsHttpError } from '@supabase/supabase-js'
import type { ApiErrorBody } from '@contracts/errors'
import { getSupabaseClient } from '@/lib/supabase/client'

/** Код ошибки API, `network` (нет связи) или `unavailable` (Supabase не настроен). */
export type ClientErrorCode = ApiErrorBody['error'] | 'network' | 'unavailable'

export class ApiCallError extends Error {
  readonly code: ClientErrorCode
  readonly fields: Record<string, string>

  constructor(code: ClientErrorCode, fields: Record<string, string> = {}) {
    super(code)
    this.code = code
    this.fields = fields
  }
}

/** Вызов операции функции `api`, например `account/me`. Ошибка никогда не выдаётся за успех. */
export async function callApi<T>(route: string, body: object = {}): Promise<T> {
  const supabase = getSupabaseClient()
  if (!supabase) throw new ApiCallError('unavailable')
  const { data, error } = await supabase.functions.invoke<T>(`api/${route}`, {
    body,
  })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) {
    const payload = (await (error.context as Response)
      .json()
      .catch(() => null)) as ApiErrorBody | null
    throw new ApiCallError(payload?.error ?? 'internal', payload?.fields)
  }
  throw new ApiCallError('network')
}
