import type { AppDeps } from '../app.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import { requireRole, type Actor, type ProfiledActor } from '../auth/actor.ts'
import {
  BROADCAST_LIMITS,
  broadcastIdSchema,
  prefillSchema,
  saveBroadcastTemplateSchema,
  saveDraftSchema,
  sendAnnouncementSchema,
  type BroadcastChannel,
  type BroadcastDraftsResponse,
  type BroadcastTemplatesResponse,
  type PrefillResponse,
  type BroadcastRecipientsResponse,
  type ChannelDelivery,
  type SendableChannel,
  type SendAnnouncementResponse,
} from '../contracts/broadcasts.ts'
import { EVENT_TYPE_LABELS, type EventType } from '../contracts/events.ts'
import { parseTimestamp, utcToMoscow } from '../contracts/moscow-time.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import { groupRepository } from '../groups/repository.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { deliverAnnouncement } from '../telegram/announcements.ts'
import { telegramRepository } from '../telegram/repository.ts'
import { requireTelegram } from '../telegram/service.ts'
import { deliverMaxAnnouncement } from '../max/announcements.ts'
import { maxRepository } from '../max/repository.ts'
import { requireMax } from '../max/service.ts'
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
        'Ответьте кнопками под сообщением или на сайте: «Приду», «50/50» или «Не приду».',
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

/** Число получателей по каналам для окна подтверждения (TGM-11, MAX-05). */
export async function broadcastRecipients(
  deps: AppDeps,
  actor: Actor,
): Promise<BroadcastRecipientsResponse> {
  requireRole(actor, BROADCAST_MANAGERS)
  const [telegram, max] = await Promise.all([
    telegramRepository.recipientCount(deps.db),
    maxRepository.recipientCount(deps.db),
  ])
  return {
    count: telegram,
    channels: {
      telegram: { configured: Boolean(deps.telegram), count: telegram },
      max: { configured: Boolean(deps.max), count: max },
    },
  }
}

const CHANNEL_NAMES: Record<SendableChannel, string> = {
  telegram: 'Telegram',
  max: 'MAX',
}

const EMPTY_DELIVERY: ChannelDelivery = { recipients: 0, sent: 0, failed: 0 }

/**
 * Отправка анонса в выбранные каналы (TGM-11–TGM-24, MAX-05–MAX-12, Q-81,
 * Q-85, Q-92, Q-97): анонс события — с кнопками, только для незакрытого и
 * не начавшегося события; канал не настроен — отказ его кодом; без
 * получателей во всех выбранных каналах — отказ. Одна запись аудита.
 */
export async function sendAnnouncement(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<SendAnnouncementResponse> {
  const user = requireRole(actor, BROADCAST_MANAGERS)
  const input = parseBody(sendAnnouncementSchema, body)
  const telegram = input.channels.includes('telegram')
    ? requireTelegram(deps)
    : null
  const max = input.channels.includes('max') ? requireMax(deps) : null
  const event = input.eventId
    ? await eventRepository.find(deps.db, input.eventId)
    : null
  if (input.eventId && !event) {
    throw new ApiError('not_found')
  }
  if (event?.closed_at) {
    throw new ApiError('state_conflict', { reason: 'closed' })
  }
  if (event && parseTimestamp(event.starts_at) <= deps.now()) {
    throw new ApiError('state_conflict', { reason: 'started' })
  }
  const [telegramCount, maxCount] = await Promise.all([
    telegram ? telegramRepository.recipientCount(deps.db) : 0,
    max ? maxRepository.recipientCount(deps.db) : 0,
  ])
  if (telegramCount + maxCount === 0) {
    throw new ApiError('state_conflict', { reason: 'no_recipients' })
  }
  const text = { subject: input.subject, body: input.body }
  const eventId = event?.id ?? null
  // Каналы независимы (разные боты и лимиты) — отправка параллельно;
  // канал без получателей пропускается (MAX-09).
  const [telegramResult, maxResult] = await Promise.all([
    telegram && telegramCount > 0
      ? deliverAnnouncement(deps, telegram, text, eventId)
      : null,
    max && maxCount > 0
      ? deliverMaxAnnouncement(deps, max, text, eventId)
      : null,
  ])
  const channels: Partial<Record<SendableChannel, ChannelDelivery>> = {}
  if (telegram) {
    channels.telegram = telegramResult ?? EMPTY_DELIVERY
  }
  if (max) {
    channels.max = maxResult ?? EMPTY_DELIVERY
  }
  const totals = Object.values(channels).reduce<ChannelDelivery>(
    (sum, item) => ({
      recipients: sum.recipients + item.recipients,
      sent: sum.sent + item.sent,
      failed: sum.failed + item.failed,
    }),
    EMPTY_DELIVERY,
  )
  const names = input.channels.map((channel) => CHANNEL_NAMES[channel])
  await withTransaction(deps.db, (tx) =>
    writeAudit(tx, {
      category: 'broadcast',
      action: 'broadcast_sent',
      summary: `${event ? 'Отправка анонса события' : 'Отправка анонса'} в ${names.join(' и ')}`,
      actor: auditPerson(user),
      ...(event ? { target: { kind: 'event', id: event.id } } : {}),
      details: {
        title: input.subject,
        event_id: event?.id ?? null,
        source_kind: event ? 'event' : null,
        channels: input.channels,
        recipients: totals.recipients,
        sent: totals.sent,
        failed: totals.failed,
        ...(channels.telegram
          ? {
              telegram_sent: channels.telegram.sent,
              telegram_failed: channels.telegram.failed,
            }
          : {}),
        ...(channels.max
          ? { max_sent: channels.max.sent, max_failed: channels.max.failed }
          : {}),
      },
    }),
  )
  return { ...totals, channels }
}
