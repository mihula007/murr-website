import {
  checkNickname,
  completeRegistration,
  createAvatarUpload,
  getMe,
  updateProfile,
} from './account/service.ts'
import { listAccounts, restoreReader, setRole } from './accounts/service.ts'
import {
  decideApplication,
  finalDecideApplication,
  getApplication,
  listApplications,
  resubmitApplication,
  submitApplicationToVote,
} from './applications/service.ts'
import { GUEST, loadActor } from './auth/actor.ts'
import {
  bearerToken,
  createTokenVerifier,
  type TokenVerifier,
} from './auth/token.ts'
import { listClasses } from './catalog/service.ts'
import { createDb, type Db } from './db/client.ts'
import {
  createEvent,
  deleteEvent,
  deleteTemplate,
  ensureWeeklyEvents,
  getEvent,
  listEvents,
  listTemplates,
  respondToEvent,
  saveTemplate,
  templateNextDate,
  updateEvent,
} from './events/service.ts'
import { createApiHandler, type Route } from './http/handler.ts'
import {
  countRoster,
  listReaders,
  listRoster,
  rosterStats,
} from './roster/service.ts'
import { createStorageGateway, type StorageGateway } from './storage/gateway.ts'
import {
  castBallot,
  closeVote,
  createVote,
  deleteVote,
  getVote,
  listVotes,
  updateVote,
} from './votes/service.ts'

export type AppEnv = {
  dbUrl: string
  supabaseUrl: string
  apiKey: string
  serviceKey: string
  /** Секрет вызова выпуска постоянных событий по расписанию (Q-42). */
  cronSecret?: string | null
}

export type AppDeps = {
  db: Db
  storage: StorageGateway
  now: () => Date
  /** null — выпуск по расписанию не принимается. */
  cronSecret?: string | null
}

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
    'applications/list': ({ actor, body }) =>
      listApplications(deps, actor, body),
    'applications/get': ({ actor, body }) => getApplication(deps, actor, body),
    'applications/decide': ({ actor, body }) =>
      decideApplication(deps, actor, body),
    'applications/resubmit': ({ actor, body }) =>
      resubmitApplication(deps, actor, body),
    'applications/submit-to-vote': ({ actor, body }) =>
      submitApplicationToVote(deps, actor, body),
    'applications/final-decide': ({ actor, body }) =>
      finalDecideApplication(deps, actor, body),
    'votes/list': ({ actor, body }) => listVotes(deps, actor, body),
    'votes/get': ({ actor, body }) => getVote(deps, actor, body),
    'votes/create': ({ actor, body }) => createVote(deps, actor, body),
    'votes/update': ({ actor, body }) => updateVote(deps, actor, body),
    'votes/cast': ({ actor, body }) => castBallot(deps, actor, body),
    'votes/close': ({ actor, body }) => closeVote(deps, actor, body),
    'votes/delete': ({ actor, body }) => deleteVote(deps, actor, body),
    'events/list': ({ actor, body }) => listEvents(deps, actor, body),
    'events/get': ({ actor, body }) => getEvent(deps, actor, body),
    'events/create': ({ actor, body }) => createEvent(deps, actor, body),
    'events/update': ({ actor, body }) => updateEvent(deps, actor, body),
    'events/delete': ({ actor, body }) => deleteEvent(deps, actor, body),
    'events/respond': ({ actor, body }) => respondToEvent(deps, actor, body),
    'events/ensure-weekly': ({ actor, headers }) =>
      ensureWeeklyEvents(deps, actor, headers.get('x-cron-secret')),
    'events/templates': ({ actor }) => listTemplates(deps, actor),
    'events/template-save': ({ actor, body }) =>
      saveTemplate(deps, actor, body),
    'events/template-delete': ({ actor, body }) =>
      deleteTemplate(deps, actor, body),
    'events/template-next': ({ actor, body }) =>
      templateNextDate(deps, actor, body),
    'roster/count': () => countRoster(deps),
    'roster/stats': ({ actor }) => rosterStats(deps, actor),
    'roster/list': ({ actor, body }) => listRoster(deps, actor, body),
    'roster/readers': ({ actor, body }) => listReaders(deps, actor, body),
    'accounts/list': ({ actor, body }) => listAccounts(deps, actor, body),
    'accounts/set-role': ({ actor, body }) => setRole(deps, actor, body),
    'accounts/restore-reader': ({ actor, body }) =>
      restoreReader(deps, actor, body),
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
    cronSecret: env.cronSecret || null,
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
