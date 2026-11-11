import type { Actor } from '../auth/actor.ts'
import type { ApiErrorBody } from '../contracts/errors.ts'
import { ApiError } from './errors.ts'

export type RouteInput = { body: unknown; actor: Actor; headers: Headers }
export type Route = (input: RouteInput) => Promise<unknown>

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** Имя маршрута — часть пути после `/api/`, например `account/me`. */
export function routeName(url: string) {
  const path = new URL(url).pathname
  const index = path.indexOf('/api/')
  return index === -1 ? '' : path.slice(index + '/api/'.length)
}

export function createApiHandler(options: {
  routes: Record<string, Route>
  resolveActor: (request: Request) => Promise<Actor>
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return json(200, {})
    }
    const route = options.routes[routeName(request.url)]
    if (!route || request.method !== 'POST') {
      return json(404, { error: 'not_found' } satisfies ApiErrorBody)
    }
    try {
      const text = await request.text()
      let body: unknown = {}
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        throw new ApiError('validation_failed')
      }
      const actor = await options.resolveActor(request)
      return json(200, await route({ body, actor, headers: request.headers }))
    } catch (error) {
      if (error instanceof ApiError) {
        const body: ApiErrorBody = { error: error.code }
        if (error.fields) {
          body.fields = error.fields
        }
        return json(error.status, body)
      }
      // Подробности только в логах функции, клиенту — общий код.
      console.error(error)
      return json(500, { error: 'internal' } satisfies ApiErrorBody)
    }
  }
}
