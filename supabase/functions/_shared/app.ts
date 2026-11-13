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
  deleteBroadcastTemplate,
  deleteDraft,
  listBroadcastTemplates,
  listDrafts,
  prefillBroadcast,
  saveBroadcastTemplate,
  saveDraft,
} from './broadcasts/service.ts'
import {
  bearerToken,
  createTokenVerifier,
  type TokenVerifier,
} from './auth/token.ts'
import { listClasses } from './catalog/service.ts'
import { createDb, type Db } from './db/client.ts'
import {
  discussionChanges,
  editMessage,
  listDiscussion,
  markDiscussionRead,
  messageReaders,
  messageReactions,
  reactToMessage,
  sendMessage,
} from './discussions/service.ts'
import {
  closeEvent,
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
import {
  activityEvent,
  activityEvents,
  activityHistory,
  activityMember,
  activitySummary,
  attendanceRating,
  monthTop,
} from './activity/service.ts'
import {
  applyGroupTemplate,
  createGroup,
  deleteGroup,
  deleteGroupTemplate,
  listGroupTemplates,
  moveMember,
  renameGroup,
  saveGroupTemplate,
  setGroupLeader,
} from './groups/service.ts'
import { createApiHandler, type Route } from './http/handler.ts'
import {
  listNotifications,
  markSectionSeen,
  notificationSummary,
  readAllNotifications,
  readNotification,
} from './notifications/service.ts'
import {
  deleteListing,
  getListing,
  listListings,
  saveListing,
  unpublishListing,
} from './market/service.ts'
import {
  createPublicationUpload,
  deletePublication,
  discardPublicationUploads,
  getPublication,
  listPublications,
  savePublication,
  unpublishPublication,
} from './publications/service.ts'
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
    'events/close': ({ actor, body }) => closeEvent(deps, actor, body),
    'events/ensure-weekly': ({ actor, headers }) =>
      ensureWeeklyEvents(deps, actor, headers.get('x-cron-secret')),
    'events/templates': ({ actor }) => listTemplates(deps, actor),
    'events/template-save': ({ actor, body }) =>
      saveTemplate(deps, actor, body),
    'events/template-delete': ({ actor, body }) =>
      deleteTemplate(deps, actor, body),
    'events/template-next': ({ actor, body }) =>
      templateNextDate(deps, actor, body),
    'groups/create': ({ actor, body }) => createGroup(deps, actor, body),
    'groups/rename': ({ actor, body }) => renameGroup(deps, actor, body),
    'groups/delete': ({ actor, body }) => deleteGroup(deps, actor, body),
    'groups/move': ({ actor, body }) => moveMember(deps, actor, body),
    'groups/set-leader': ({ actor, body }) => setGroupLeader(deps, actor, body),
    'group-templates/list': ({ actor }) => listGroupTemplates(deps, actor),
    'group-templates/save': ({ actor, body }) =>
      saveGroupTemplate(deps, actor, body),
    'group-templates/delete': ({ actor, body }) =>
      deleteGroupTemplate(deps, actor, body),
    'group-templates/apply': ({ actor, body }) =>
      applyGroupTemplate(deps, actor, body),
    'activity/summary': ({ actor, body }) => activitySummary(deps, actor, body),
    'activity/history': ({ actor, body }) => activityHistory(deps, actor, body),
    'activity/events': ({ actor, body }) => activityEvents(deps, actor, body),
    'activity/event': ({ actor, body }) => activityEvent(deps, actor, body),
    'activity/member': ({ actor, body }) => activityMember(deps, actor, body),
    'activity/rating': ({ actor }) => attendanceRating(deps, actor),
    'activity/month-top': ({ actor }) => monthTop(deps, actor),
    'publications/list': ({ actor, body }) =>
      listPublications(deps, actor, body),
    'publications/get': ({ actor, body }) => getPublication(deps, actor, body),
    'publications/upload-url': ({ actor, body }) =>
      createPublicationUpload(deps, actor, body),
    'publications/discard-uploads': ({ actor, body }) =>
      discardPublicationUploads(deps, actor, body),
    'publications/save': ({ actor, body }) =>
      savePublication(deps, actor, body),
    'publications/unpublish': ({ actor, body }) =>
      unpublishPublication(deps, actor, body),
    'publications/delete': ({ actor, body }) =>
      deletePublication(deps, actor, body),
    'market/list': ({ actor, body }) => listListings(deps, actor, body),
    'market/get': ({ actor, body }) => getListing(deps, actor, body),
    'market/save': ({ actor, body }) => saveListing(deps, actor, body),
    'market/unpublish': ({ actor, body }) =>
      unpublishListing(deps, actor, body),
    'market/delete': ({ actor, body }) => deleteListing(deps, actor, body),
    'discussions/list': ({ actor, body }) => listDiscussion(deps, actor, body),
    'discussions/changes': ({ actor, body }) =>
      discussionChanges(deps, actor, body),
    'discussions/send': ({ actor, body }) => sendMessage(deps, actor, body),
    'discussions/edit': ({ actor, body }) => editMessage(deps, actor, body),
    'discussions/react': ({ actor, body }) => reactToMessage(deps, actor, body),
    'discussions/mark-read': ({ actor, body }) =>
      markDiscussionRead(deps, actor, body),
    'discussions/readers': ({ actor, body }) =>
      messageReaders(deps, actor, body),
    'discussions/reactions': ({ actor, body }) =>
      messageReactions(deps, actor, body),
    'notifications/summary': ({ actor }) => notificationSummary(deps, actor),
    'notifications/list': ({ actor }) => listNotifications(deps, actor),
    'notifications/read': ({ actor, body }) =>
      readNotification(deps, actor, body),
    'notifications/read-all': ({ actor }) => readAllNotifications(deps, actor),
    'notifications/section-seen': ({ actor, body }) =>
      markSectionSeen(deps, actor, body),
    'roster/count': () => countRoster(deps),
    'roster/stats': ({ actor }) => rosterStats(deps, actor),
    'roster/list': ({ actor }) => listRoster(deps, actor),
    'roster/readers': ({ actor, body }) => listReaders(deps, actor, body),
    'accounts/list': ({ actor, body }) => listAccounts(deps, actor, body),
    'accounts/set-role': ({ actor, body }) => setRole(deps, actor, body),
    'accounts/restore-reader': ({ actor, body }) =>
      restoreReader(deps, actor, body),
    'broadcasts/prefill': ({ actor, body }) =>
      prefillBroadcast(deps, actor, body),
    'broadcasts/drafts': ({ actor }) => listDrafts(deps, actor),
    'broadcasts/save-draft': ({ actor, body }) => saveDraft(deps, actor, body),
    'broadcasts/delete-draft': ({ actor, body }) =>
      deleteDraft(deps, actor, body),
    'broadcasts/templates': ({ actor }) => listBroadcastTemplates(deps, actor),
    'broadcasts/save-template': ({ actor, body }) =>
      saveBroadcastTemplate(deps, actor, body),
    'broadcasts/delete-template': ({ actor, body }) =>
      deleteBroadcastTemplate(deps, actor, body),
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
