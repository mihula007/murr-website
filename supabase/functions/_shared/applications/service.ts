import { avatarUrl, avatarUrls } from '../account/avatars.ts'
import { profileRepository } from '../account/repository.ts'
import { buildMe } from '../account/service.ts'
import type { AppDeps } from '../app.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor } from '../auth/actor.ts'
import { userRepository } from '../auth/repository.ts'
import type {
  AccessRole,
  ApplicationStatus,
  MeResponse,
} from '../contracts/account.ts'
import {
  APPLICATION_PAGE_SIZE,
  applicationIdSchema,
  decideApplicationSchema,
  listApplicationsSchema,
  resubmitApplicationSchema,
  type ApplicationDetails,
  type ApplicationListResponse,
} from '../contracts/applications.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import { isUniqueViolation } from '../db/errors.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { joinedOnAfterRoleChange, moscowDate } from '../membership.ts'
import { notify } from '../notifications/service.ts'
import {
  applicationRepository,
  DECIDED_STATUSES,
  ONE_ACTIVE_CONSTRAINT,
} from './repository.ts'

/** Рассматривают заявки офицеры и администраторы (APP-03, ACL). */
const REVIEWERS = ['officer', 'admin'] as const

const NEW_STATUS = 'pending_officer_review'

const DECISIONS = {
  accept: {
    status: 'officer_approved',
    action: 'application_accepted_directly',
    summary: 'Прямой приём без голосования',
    notification: {
      kind: 'application_accepted',
      title: 'Заявка принята',
      body: 'Добро пожаловать в клан! Внутренние разделы открыты.',
    },
  },
  reject: {
    status: 'officer_rejected',
    action: 'application_rejected',
    summary: 'Отказ по заявке',
    notification: {
      kind: 'application_rejected',
      title: 'Заявка отклонена',
      body: 'Можно подать новую заявку в личном кабинете.',
    },
  },
} as const

export async function listApplications(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ApplicationListResponse> {
  requireRole(actor, REVIEWERS)
  const { tab, page } = parseBody(listApplicationsSchema, body)
  const isNew = tab === 'new'
  const [rows, newCount] = await Promise.all([
    applicationRepository.listQueue(deps.db, {
      statuses: isNew ? [NEW_STATUS] : DECIDED_STATUSES,
      order: isNew ? 'oldest_submitted' : 'latest_decided',
      // Новые показываются целиком; решённые — постранично.
      limit: isNew ? 1000 : APPLICATION_PAGE_SIZE + 1,
      offset: isNew ? 0 : page * APPLICATION_PAGE_SIZE,
    }),
    applicationRepository.countByStatus(deps.db, NEW_STATUS),
  ])
  const visible = isNew ? rows : rows.slice(0, APPLICATION_PAGE_SIZE)
  const urls = await avatarUrls(
    deps.storage,
    visible.map((row) => row.avatar_path),
  )
  return {
    items: visible.map((row) => ({
      id: row.id,
      status: row.status as ApplicationStatus,
      submittedAt: row.submitted_at,
      decidedAt: row.decided_at,
      applicant: {
        id: row.applicant_id,
        gameNickname: row.game_nickname,
        classId: row.class_id,
        className: row.class_name,
        avatarUrl: row.avatar_path ? (urls.get(row.avatar_path) ?? null) : null,
      },
    })),
    page: isNew ? 0 : page,
    hasMore: !isNew && rows.length > APPLICATION_PAGE_SIZE,
    newCount,
  }
}

/**
 * Карточка для исполнителя. Поля, которых роль не видит, не попадают в объект
 * ответа: офицер не получает email, город и дату рождения (APP-03, ACL-10).
 */
async function loadDetails(
  deps: AppDeps,
  db: Executor,
  role: AccessRole,
  id: string,
): Promise<ApplicationDetails> {
  const row = await applicationRepository.findDetails(db, id)
  if (!row) throw new ApiError('not_found')
  const [links, url] = await Promise.all([
    applicationRepository.links(db, id),
    avatarUrl(deps.storage, row.avatar_path),
  ])
  const details: ApplicationDetails = {
    id: row.id,
    status: row.status as ApplicationStatus,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    decidedBy: row.decided_by_nickname
      ? { gameNickname: row.decided_by_nickname }
      : null,
    equipmentLinks: links,
    applicant: {
      id: row.applicant_id,
      displayName: row.display_name,
      gameNickname: row.game_nickname,
      classId: row.class_id,
      className: row.class_name,
      avatarUrl: url,
      about: row.about,
    },
  }
  if (role === 'admin') {
    details.contacts = {
      email: row.email ?? '',
      city: row.city,
      birthDate: row.birth_date,
    }
  }
  return details
}

export async function getApplication(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ApplicationDetails> {
  const reviewer = requireRole(actor, REVIEWERS)
  const { id } = parseBody(applicationIdSchema, body)
  return loadDetails(
    deps,
    deps.db,
    reviewer.profile.access_role as AccessRole,
    id,
  )
}

/**
 * Прямое решение по новой заявке без голосования (APP-04, ADM-05, Q-24).
 * Одна транзакция: статус, роль и дата вступления при приёме, уведомление
 * кандидату (APP-14) и аудит. Повтор и параллельное решение — state_conflict.
 */
export async function decideApplication(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<ApplicationDetails> {
  const reviewer = requireRole(actor, REVIEWERS)
  const input = parseBody(decideApplicationSchema, body)
  const decision = DECISIONS[input.decision]
  const now = deps.now()

  await withTransaction(deps.db, async (tx) => {
    const applicantId = await applicationRepository.decide(
      tx,
      input.id,
      NEW_STATUS,
      {
        status: decision.status,
        decided_by: reviewer.userId,
        decided_at: now.toISOString(),
        decision_note: input.note,
      },
    )
    if (!applicantId) {
      throw new ApiError(
        (await applicationRepository.exists(tx, input.id))
          ? 'state_conflict'
          : 'not_found',
      )
    }
    const applicant = await profileRepository.findByIdForUpdate(tx, applicantId)
    // Роль кандидата с активной заявкой меняется только здесь (accounts/set-role
    // отклоняет её), поэтому иная роль означает гонку.
    if (!applicant || applicant.access_role !== 'applicant') {
      throw new ApiError('state_conflict')
    }
    const previousRole = applicant.access_role as AccessRole
    const nextRole: AccessRole =
      input.decision === 'accept' ? 'member' : previousRole
    if (nextRole !== previousRole) {
      await profileRepository.update(tx, applicantId, {
        access_role: nextRole,
        joined_on: joinedOnAfterRoleChange(
          previousRole,
          nextRole,
          applicant.joined_on,
          moscowDate(now),
        ),
        updated_at: now.toISOString(),
      })
    }

    const target = { kind: 'join_application', id: input.id }
    await notify(tx, {
      recipientId: applicantId,
      actorId: reviewer.userId,
      ...decision.notification,
      target,
      source: target,
    })
    const user = await userRepository.findById(tx, applicantId)
    await writeAudit(tx, {
      category: 'applications',
      action: decision.action,
      summary: decision.summary,
      actor: auditPerson(reviewer),
      target: {
        ...target,
        user: {
          id: applicantId,
          role: nextRole,
          nickname: applicant.game_nickname,
          email: user?.email ?? null,
        },
      },
      details: {
        application_id: input.id,
        profile_id: applicantId,
        decision: input.decision,
        previous_role: previousRole,
        role: nextRole,
      },
    })
  })
  return loadDetails(
    deps,
    deps.db,
    reviewer.profile.access_role as AccessRole,
    input.id,
  )
}

/** Поля профиля, обязательные при регистрации (Q-15); после неё их можно очистить. */
const REQUIRED_PROFILE_FIELDS = {
  city: 'city',
  birthDate: 'birth_date',
  about: 'about',
} as const

/**
 * Новая заявка кандидата без активной заявки (APP-10, Q-06). Из прежней ничего
 * не переносится (Q-37): ссылки приходят заново, данные — из текущего профиля.
 */
export async function resubmitApplication(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<MeResponse> {
  const applicant = requireRole(actor, ['applicant'])
  const { equipmentLinks } = parseBody(resubmitApplicationSchema, body)

  const missing: Record<string, string> = {}
  for (const [field, column] of Object.entries(REQUIRED_PROFILE_FIELDS)) {
    if (!applicant.profile[column]) missing[field] = 'required'
  }
  if (Object.keys(missing).length > 0) {
    throw new ApiError('validation_failed', missing)
  }
  if (await applicationRepository.hasActive(deps.db, applicant.userId)) {
    throw new ApiError('state_conflict')
  }

  try {
    await withTransaction(deps.db, async (tx) => {
      const applicationId = await applicationRepository.create(
        tx,
        applicant.userId,
        equipmentLinks,
      )
      const person = auditPerson(applicant)
      await writeAudit(tx, {
        category: 'applications',
        action: 'application_resubmitted',
        summary: 'Подача новой заявки',
        actor: person,
        target: { kind: 'join_application', id: applicationId, user: person },
        details: {
          application_id: applicationId,
          profile_id: applicant.userId,
        },
      })
    })
  } catch (error) {
    // Вторая вкладка уже подала заявку: активная может быть только одна.
    if (isUniqueViolation(error, ONE_ACTIVE_CONSTRAINT)) {
      throw new ApiError('state_conflict')
    }
    throw error
  }
  return buildMe(deps, applicant)
}
