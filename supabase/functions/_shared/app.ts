import {
  checkNickname,
  completeRegistration,
  createAvatarUpload,
  getMe,
  updateProfile,
} from './account/service.ts'
import { GUEST, loadActor } from './auth/actor.ts'
import {
  bearerToken,
  createTokenVerifier,
  type TokenVerifier,
} from './auth/token.ts'
import { listClasses } from './catalog/service.ts'
import { createDb, type Db } from './db/client.ts'
import { createApiHandler, type Route } from './http/handler.ts'
import { createStorageGateway, type StorageGateway } from './storage/gateway.ts'

export type AppEnv = {
  dbUrl: string
  supabaseUrl: string
  apiKey: string
  serviceKey: string
}

export type AppDeps = { db: Db; storage: StorageGateway; now: () => Date }

export function createRoutes(deps: AppDeps): Record<string, Route> {
  return {
    'catalog/classes': () => listClasses(deps.db),
    'account/check-nickname': ({ body }) => checkNickname(deps, body),
    'account/me': ({ actor }) => getMe(deps, actor),
    'account/avatar-upload': ({ actor, body }) =>
      createAvatarUpload(deps, actor, body),
    'account/complete-registration': ({ actor, body }) =>
      completeRegistration(deps, actor, body),
    'account/update-profile': ({ actor, body }) =>
      updateProfile(deps, actor, body),
  }
}

export function createApp(
  env: AppEnv,
  overrides: { verifyToken?: TokenVerifier } = {},
) {
  const deps: AppDeps = {
    db: createDb(env.dbUrl),
    storage: createStorageGateway(env.supabaseUrl, env.serviceKey),
    now: () => new Date(),
  }
  const verifyToken =
    overrides.verifyToken ?? createTokenVerifier(env.supabaseUrl, env.apiKey)
  const handler = createApiHandler({
    routes: createRoutes(deps),
    resolveActor: async (request) => {
      const token = bearerToken(request)
      const userId = token ? await verifyToken(token) : null
      return userId ? loadActor(deps.db, userId) : GUEST
    },
  })
  return { handler, deps }
}
