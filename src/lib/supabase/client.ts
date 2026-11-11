import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '@/lib/errors'
import { readSupabaseConfig } from './config'

let client: SupabaseClient | undefined

// No client or network activity until a feature actually requests Supabase.
export function getSupabaseClient(): SupabaseClient | null {
  const config = readSupabaseConfig(import.meta.env)
  if (!config) return null

  client ??= createClient(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      // Hash belongs to TanStack Router; configure the Auth callback explicitly.
      detectSessionInUrl: false,
    },
  })
  return client
}

/** Клиент для операции; без конфигурации — `AppError('unavailable')`. */
export function requireSupabase(): SupabaseClient {
  const supabase = getSupabaseClient()
  if (!supabase) throw new AppError('unavailable')
  return supabase
}
