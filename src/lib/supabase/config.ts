export interface SupabaseConfig {
  url: string
  publishableKey: string
}

export function readSupabaseConfig(
  env: Record<string, unknown>,
): SupabaseConfig | null {
  const allowedNames = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
  if (
    Object.keys(env).some(
      (name) => name.startsWith('VITE_') && !allowedNames.includes(name),
    )
  ) {
    throw new Error('Обнаружены неразрешённые публичные переменные VITE_*')
  }

  const url = String(env.VITE_SUPABASE_URL ?? '').trim()
  const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  if (!url && !publishableKey) {
    return null
  }
  if (!url || !publishableKey) {
    throw new Error('Для Supabase необходимо задать обе переменные окружения')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('URL Supabase должен быть корректным HTTPS-адресом')
  }

  const localHttp =
    parsedUrl.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)

  if (
    (parsedUrl.protocol !== 'https:' && !localHttp) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.pathname !== '/'
  ) {
    throw new Error('URL Supabase должен быть HTTPS origin без учётных данных')
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error('Для браузера разрешён только Supabase publishable key')
  }

  return { url: parsedUrl.origin, publishableKey }
}
