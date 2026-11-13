import type { AppDeps } from '../app.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import {
  BROADCAST_LIMITS,
  broadcastIdSchema,
  prefillSchema,
  saveBroadcastTemplateSchema,
  saveDraftSchema,
  type BroadcastAttachment,
  type BroadcastChannel,
  type BroadcastDraftsResponse,
  type BroadcastTemplatesResponse,
  type PrefillResponse,
} from '../contracts/broadcasts.ts'
import { EVENT_TYPE_LABELS, type EventType } from '../contracts/events.ts'
import { utcToMoscow } from '../contracts/moscow-time.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import { groupRepository } from '../groups/repository.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { voteRepository } from '../votes/repository.ts'
import { broadcastRepository } from './repository.ts'

/** Готовят рассылки офицеры и администраторы (BRC, Q-70). */
export const BROADCAST_MANAGERS = ['officer', 'admin'] as const

const canDelete = (user: ProfiledActor, authorId: string) =>
  user.userId === authorId || user.profile.access_role === 'admin'

function formatMoscow(moment: string) {
  const { date, time } = utcToMoscow(moment)
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year} ${time} МСК`
}

/** Тема и текст из события, голосования или группы (BRC-02–04). */
export async function prefillBroadcast(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<PrefillResponse> {
  requireRole(actor, BROADCAST_MANAGERS)
  const input = parseBody(prefillSchema, body)

  if (input.source === 'event') {
    const event = await eventRepository.find(deps.db, input.id)
    if (!event) {
      throw new ApiError('not_found')
    }
    if (event.closed_at) {
      throw new ApiError('state_conflict')
    }
    return {
      subject: event.title,
      body: [
        event.title,
        `Тип: ${EVENT_TYPE_LABELS[event.event_type as EventType]}`,
        `Когда: ${formatMoscow(event.starts_at)}`,
        '',
        event.description,
        '',
        'Отметьтесь на сайте: «Приду», «50/50» или «Не приду».',
      ].join('\n'),
      recipients: null,
    }
  }

  if (input.source === 'vote') {
    const vote = await voteRepository.find(deps.db, input.id)
    if (!vote) {
      throw new ApiError('not_found')
    }
    if (vote.closed_at) {
      throw new ApiError('state_conflict')
    }
    const lines = [`Голосование: ${vote.title}`]
    if (vote.context) {
      lines.push('', vote.context)
    }
    lines.push('', 'Выберите ответ на сайте в разделе «Голосование».')
    return {
      subject: `Голосование: ${vote.title}`,
      body: lines.join('\n'),
      recipients: null,
    }
  }

  const group = await groupRepository.findGroup(deps.db, input.id)
  if (!group) {
    throw new ApiError('not_found')
  }
  const event = await eventRepository.find(deps.db, group.event_id)
  if (!event) {
    throw new ApiError('not_found')
  }
  const members = await broadcastRepository.groupMembers(deps.db, group.id)
  if (event.closed_at || members.length === 0) {
    throw new ApiError('state_conflict')
  }
  const recipients = members.map((member) => ({
    gameNickname: member.game_nickname,
    isLeader: member.is_leader,
  }))
  return {
    subject: `${event.title} — ${group.name}`,
    body: [
      `Группа «${group.name}» на событие «${event.title}», ${formatMoscow(event.starts_at)}.`,
      '',
      ...recipients.map(
        (person, index) =>
          `${index + 1}. ${person.gameNickname}${person.isLeader ? ' — лидер' : ''}`,
      ),
      '',
      `Получателей: ${recipients.length}.`,
    ].join('\n'),
    recipients,
  }
}

export async function listDrafts(
  deps: AppDeps,
  actor: Actor,
): Promise<BroadcastDraftsResponse> {
  const user = requireRole(actor, BROADCAST_MANAGERS)
  const rows = await broadcastRepository.drafts(
    deps.db,
    BROADCAST_LIMITS.drafts,
  )
  return {
    items: rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      body: row.body,
      channels: row.channels as BroadcastChannel[],
      attachments: row.attachments as unknown as BroadcastAttachment[],
      author: row.author_nickname
        ? { gameNickname: row.author_nickname }
        : null,
      createdAt: row.created_at,
      canDelete: canDelete(user, row.author_id),
    })),
  }
}

/** Новый черновик; сверх 50 старейший вытесняется в той же транзакции. */
export async function saveDraft(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<BroadcastDraftsResponse> {
  const user = requireRole(actor, BROADCAST_MANAGERS)
  const input = parseBody(saveDraftSchema, body)
  await withTransaction(deps.db, async (tx) => {
    await broadcastRepository.lockDrafts(tx)
    const id = await broadcastRepository.createDraft(tx, {
      authorId: user.userId,
      subject: input.subject,
      body: input.body,
      channels: input.channels,
      attachments: input.attachments,
      source: input.source,
    })
    await broadcastRepository.trimDrafts(tx, BROADCAST_LIMITS.drafts)
    await writeAudit(tx, {
      category: 'broadcast',
      action: 'broadcast_draft_saved',
      summary: 'Сохранение черновика рассылки',
      actor: auditPerson(user),
      target: { kind: 'broadcast_draft', id },
      details: {
        draft_id: id,
        title: input.subject,
        channels: input.channels,
        source_kind: input.source?.kind ?? null,
      },
    })
  })
  return listDrafts(deps, user)
}

export async function deleteDraft(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<BroadcastDraftsResponse> {
  const user = requireRole(actor, BROADCAST_MANAGERS)
  const { id } = parseBody(broadcastIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    await broadcastRepository.lockDrafts(tx)
    const draft = await broadcastRepository.findDraft(tx, id)
    if (!draft) {
      throw new ApiError('not_found')
    }
    if (!canDelete(user, draft.author_id)) {
      throw new ApiError('forbidden')
    }
    await broadcastRepository.deleteDraft(tx, id)
    await writeAudit(tx, {
      category: 'broadcast',
      action: 'broadcast_draft_deleted',
      summary: 'Удаление черновика рассылки',
      actor: auditPerson(user),
      target: { kind: 'broadcast_draft', id },
      details: { draft_id: id, title: draft.subject },
    })
  })
  return listDrafts(deps, user)
}

export async function listBroadcastTemplates(
  deps: AppDeps,
  actor: Actor,
): Promise<BroadcastTemplatesResponse> {
  const user = requireRole(actor, BROADCAST_MANAGERS)
  const rows = await broadcastRepository.templates(
    deps.db,
    BROADCAST_LIMITS.templates,
  )
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      subject: row.subject,
      body: row.body,
      channels: row.channels as BroadcastChannel[],
      author: row.author_nickname
        ? { gameNickname: row.author_nickname }
        : null,
      canDelete: canDelete(user, row.author_id),
    })),
  }
}

/** Новый шаблон; не больше 20 на всех, название уникально (BRC-10). */
export async function saveBroadcastTemplate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<BroadcastTemplatesResponse> {
  const user = requireRole(actor, BROADCAST_MANAGERS)
  const input = parseBody(saveBroadcastTemplateSchema, body)
  await withTransaction(deps.db, async (tx) => {
    await broadcastRepository.lockTemplates(tx)
    if (
      (await broadcastRepository.countTemplates(tx)) >=
      BROADCAST_LIMITS.templates
    ) {
      throw new ApiError('validation_failed', { limit: 'too_many' })
    }
    if (await broadcastRepository.templateNameTaken(tx, input.name)) {
      throw new ApiError('validation_failed', { name: 'duplicate' })
    }
    const id = await broadcastRepository.createTemplate(tx, {
      authorId: user.userId,
      name: input.name,
      subject: input.subject,
      body: input.body,
      channels: input.channels,
    })
    await writeAudit(tx, {
      category: 'broadcast',
      action: 'broadcast_template_saved',
      summary: 'Сохранение шаблона рассылки',
      actor: auditPerson(user),
      target: { kind: 'broadcast_template', id },
      details: { template_id: id, title: input.name, channels: input.channels },
    })
  })
  return listBroadcastTemplates(deps, user)
}

export async function deleteBroadcastTemplate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<BroadcastTemplatesResponse> {
  const user = requireRole(actor, BROADCAST_MANAGERS)
  const { id } = parseBody(broadcastIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    await broadcastRepository.lockTemplates(tx)
    const template = await broadcastRepository.findTemplate(tx, id)
    if (!template) {
      throw new ApiError('not_found')
    }
    if (!canDelete(user, template.author_id)) {
      throw new ApiError('forbidden')
    }
    await broadcastRepository.deleteTemplate(tx, id)
    await writeAudit(tx, {
      category: 'broadcast',
      action: 'broadcast_template_deleted',
      summary: 'Удаление шаблона рассылки',
      actor: auditPerson(user),
      target: { kind: 'broadcast_template', id },
      details: { template_id: id, title: template.name },
    })
  })
  return listBroadcastTemplates(deps, user)
}
