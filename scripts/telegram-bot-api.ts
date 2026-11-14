// Вызовы Bot API для скриптов вебхука (этап 13). Токен входит в адрес
// запроса, поэтому ни адрес, ни текст сетевой ошибки не печатаются.

export type BotApiResult = {
  ok: boolean
  result?: unknown
  error_code?: number
  description?: string
}

export function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    console.error(`Не задана переменная ${name} в .env (см. .env.example).`)
    process.exit(1)
  }
  return value
}

export async function botApi(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<BotApiResult> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(15_000),
      },
    )
    return (await response.json()) as BotApiResult
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown'
    return { ok: false, description: `сбой запроса (${name})` }
  }
}

/** Вебхук с секретом и только нужными видами апдейтов (TGM, Q-87). */
export function setWebhook(
  token: string,
  url: string,
  secret: string,
  dropPending: boolean,
) {
  return botApi(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: dropPending,
  })
}

export function webhookUrl(functionsBase: string) {
  return `${functionsBase.replace(/\/+$/, '')}/api/telegram/webhook`
}

export function describe(result: BotApiResult) {
  return result.ok
    ? 'ок'
    : `${result.error_code ?? ''} ${result.description ?? ''}`.trim()
}
