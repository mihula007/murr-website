import type { AppDeps } from '../app.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import {
  requireProfile,
  type Actor,
  type ProfiledActor,
} from '../auth/actor.ts'
import {
  hasOfficerPermission,
  requireOfficerPermission,
} from '../officer-permissions/service.ts'
import type { AccessRole } from '../contracts/account.ts'
import {
  BROADCAST_LIMITS,
  broadcastIdSchema,
  broadcastSubscriptionsSchema,
  prefillSchema,
  saveBroadcastTemplateSchema,
  saveDraftSchema,
  recipientsSchema,
  sendAnnouncementSchema,
  type BroadcastChannel,
  type BroadcastDraftsResponse,
  type BroadcastTemplatesResponse,
  type BroadcastSubscriptionsResponse,
  type PrefillResponse,
  SENDABLE_CHANNELS,
  type BroadcastRecipientsResponse,
  type BroadcastRecipientOption,
  type ChannelDelivery,
  type ChannelRecipients,
  type SendableChannel,
  type SendAnnouncementResponse,
} from '../contracts/broadcasts.ts'
import { EVENT_TYPE_LABELS, type EventType } from '../contracts/events.ts'
import { parseTimestamp, utcToMoscow } from '../contracts/moscow-time.ts'
import { withTransaction } from '../db/client.ts'
import { eventRepository } from '../events/repository.ts'
import { groupRepository } from '../groups/repository.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { ApiError } from '../http/errors.ts'
import { parseBody } from '../http/validation.ts'
import { nicknameCursor, nicknameKey } from '../roster/cursor.ts'
import { eventImageUrl } from '../messenger/event-image.ts'
import { deliverAnnouncement } from '../telegram/announcements.ts'
import { telegramRepository } from '../telegram/repository.ts'
import { requireTelegram } from '../telegram/service.ts'
import { deliverMaxAnnouncement } from '../max/announcements.ts'
import { maxRepository } from '../max/repository.ts'
import { requireMax } from '../max/service.ts'
import type { AnnouncementText } from '../messenger/announcement.ts'
import { deliverVkAnnouncement } from '../vk/announcements.ts'
import { vkRepository } from '../vk/repository.ts'
import { requireVk } from '../vk/service.ts'
import { voteRepository } from '../votes/repository.ts'
import { broadcastRepository } from './repository.ts'

/** Read-only page of current members and messenger link states (BRC-15). */
export async function listBroadcastSubscriptions(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<BroadcastSubscriptionsResponse> {
  await requireOfficerPermission(deps, actor, 'broadcasts.subscriptions')
  const input = parseBody(broadcastSubscriptionsSchema, body ?? {})
  const rows = await broadcastRepository.subscriptions(deps.db, {
    search: input.search,
    unlinkedOnly: input.unlinkedOnly,
    after: input.cursor ? decodeCursor(nicknameCursor, input.cursor) : null,
    limit: input.limit + 1,
  })
  const page = splitPage(rows, input.limit, (row) =>
    nicknameKey(row.game_nickname, row.id),
  )
  const status = (linkedId: string | null, blockedAt: string | null) => ({
    linked: linkedId !== null,
    blocked: linkedId !== null && blockedAt !== null,
  })
  return {
    items: page.rows.map((row) => ({
      id: row.id,
      gameNickname: row.game_nickname,
      role: row.access_role as AccessRole,
      telegram: status(row.telegram_linked, row.telegram_blocked_at),
      vk: status(row.vk_linked, row.vk_blocked_at),
      max: status(row.max_linked, row.max_blocked_at),
    })),
    nextCursor: page.nextCursor,
  }
}

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
  await requireOfficerPermission(deps, actor, 'broadcasts.send')
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
      ].join('\n'),
      recipients: null,
      ...(event.recurring_preset
        ? { bodyLimit: BROADCAST_LIMITS.imageBody }
        : {}),
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
  const user = await requireOfficerPermission(deps, actor, 'broadcasts.send')
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
  const user = await requireOfficerPermission(deps, actor, 'broadcasts.send')
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
  const user = await requireOfficerPermission(deps, actor, 'broadcasts.send')
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
  const canSend = await hasOfficerPermission(deps, actor, 'broadcasts.send')
  const canManageTemplates = await hasOfficerPermission(
    deps,
    actor,
    'broadcasts.templates',
  )
  if (!canSend && !canManageTemplates) {
    throw new ApiError('forbidden')
  }
  const user = requireProfile(actor)
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
  const user = await requireOfficerPermission(
    deps,
    actor,
    'broadcasts.templates',
  )
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
  const user = await requireOfficerPermission(
    deps,
    actor,
    'broadcasts.templates',
  )
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

/**
 * Каналы отправки (MAX-05, VK-05): подключён ли бот, число получателей и
 * доставка. `deliver` вызывается только для настроенного канала.
 */
const CHANNELS: Record<
  SendableChannel,
  {
    name: string
    configured: (deps: AppDeps) => boolean
    require: (deps: AppDeps) => unknown
    count: (
      deps: AppDeps,
      groupId: string | null,
      eventId: string | null,
      excludedUserIds?: string[],
    ) => Promise<number>
    deliver: (
      deps: AppDeps,
      text: AnnouncementText,
      eventId: string | null,
      groupId: string | null,
      excludedUserIds: string[],
      preset: string | null,
    ) => Promise<ChannelDelivery>
  }
> = {
  telegram: {
    name: 'Telegram',
    configured: (deps) => Boolean(deps.telegram),
    require: requireTelegram,
    count: (deps, groupId, eventId, excludedUserIds = []) =>
      telegramRepository.recipientCount(
        deps.db,
        groupId,
        eventId,
        excludedUserIds,
      ),
    deliver: (deps, text, eventId, groupId, excludedUserIds, preset) => {
      const telegram = requireTelegram(deps)
      return deliverAnnouncement(
        deps,
        telegram,
        text,
        eventId,
        groupId,
        excludedUserIds,
        eventImageUrl(telegram.siteUrl, preset),
      )
    },
  },
  vk: {
    name: 'ВКонтакте',
    configured: (deps) => Boolean(deps.vk),
    require: requireVk,
    count: (deps, groupId, eventId, excludedUserIds = []) =>
      vkRepository.recipientCount(deps.db, groupId, eventId, excludedUserIds),
    deliver: (deps, text, eventId, groupId, excludedUserIds, preset) => {
      const vk = requireVk(deps)
      return deliverVkAnnouncement(
        deps,
        vk,
        text,
        eventId,
        groupId,
        excludedUserIds,
        eventImageUrl(vk.siteUrl, preset),
      )
    },
  },
  max: {
    name: 'MAX',
    configured: (deps) => Boolean(deps.max),
    require: requireMax,
    count: (deps, groupId, eventId, excludedUserIds = []) =>
      maxRepository.recipientCount(deps.db, groupId, eventId, excludedUserIds),
    deliver: (deps, text, eventId, groupId, excludedUserIds, preset) => {
      const max = requireMax(deps)
      return deliverMaxAnnouncement(
        deps,
        max,
        text,
        eventId,
        groupId,
        excludedUserIds,
        eventImageUrl(max.siteUrl, preset),
      )
    },
  },
}

/** Привязавшие канал без фильтра ответов — чтобы отличить «все ответили» (Q-109). */
const linkedCounts = (
  deps: AppDeps,
  channels: readonly SendableChannel[],
  groupId: string | null,
  excludedUserIds: string[],
) =>
  Promise.all(
    channels.map((channel) =>
      CHANNELS[channel].count(deps, groupId, null, excludedUserIds),
    ),
  )

/**
 * Число получателей по каналам для окна подтверждения (TGM-11, MAX-05);
 * для анонса события — без ответивших и их число (Q-109).
 */
export async function broadcastRecipients(
  deps: AppDeps,
  actor: Actor,
  body: unknown = {},
): Promise<BroadcastRecipientsResponse> {
  await requireOfficerPermission(deps, actor, 'broadcasts.send')
  const input = parseBody(recipientsSchema, body ?? {})
  if (input.groupId && input.eventId) {
    throw new ApiError('validation_failed', { groupId: 'invalid' })
  }
  const [counts, linked, rows] = await Promise.all([
    Promise.all(
      SENDABLE_CHANNELS.map((channel) =>
        CHANNELS[channel].count(
          deps,
          input.groupId,
          input.eventId,
          input.excludedUserIds,
        ),
      ),
    ),
    input.eventId
      ? linkedCounts(
          deps,
          SENDABLE_CHANNELS,
          input.groupId,
          input.excludedUserIds,
        )
      : null,
    broadcastRepository.recipientPage(deps.db, {
      channels: input.channels,
      classId: input.classId,
      search: input.search,
      after: input.cursor ? decodeCursor(nicknameCursor, input.cursor) : null,
      groupId: input.groupId,
      eventId: input.eventId,
      limit: input.limit + 1,
    }),
  ])
  const page = splitPage(rows, input.limit, (row) =>
    nicknameKey(row.game_nickname, row.id),
  )
  const channels = Object.fromEntries(
    SENDABLE_CHANNELS.map((channel, index) => [
      channel,
      {
        configured: CHANNELS[channel].configured(deps),
        count: counts[index]!,
        ...(linked ? { answered: linked[index]! - counts[index]! } : {}),
      },
    ]),
  ) as Record<SendableChannel, ChannelRecipients>
  const active = (linkedId: string | null, blockedAt: string | null): boolean =>
    linkedId !== null && blockedAt === null
  const items: BroadcastRecipientOption[] = page.rows.map((row) => ({
    id: row.id,
    gameNickname: row.game_nickname,
    channels: SENDABLE_CHANNELS.filter((channel) => {
      switch (channel) {
        case 'telegram':
          return active(row.telegram_linked, row.telegram_blocked_at)
        case 'vk':
          return active(row.vk_linked, row.vk_blocked_at)
        case 'max':
          return active(row.max_linked, row.max_blocked_at)
      }
    }),
  }))
  return {
    count: channels.telegram.count,
    channels,
    items,
    nextCursor: page.nextCursor,
  }
}

const EMPTY_DELIVERY: ChannelDelivery = { recipients: 0, sent: 0, failed: 0 }

/** «Telegram», «Telegram и MAX», «Telegram, ВКонтакте и MAX». */
function joinNames(names: string[]) {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} и ${names.at(-1)}`
    : (names[0] ?? '')
}

/**
 * Отправка анонса в выбранные каналы (TGM-11–TGM-24, MAX-05–MAX-12,
 * VK-05–VK-09, Q-81, Q-85, Q-92, Q-99, Q-102, Q-109): анонс события — с
 * кнопками, только для незакрытого и не начавшегося события и только не
 * ответившим на него; канал не настроен —
 * отказ его кодом; без получателей во всех выбранных каналах — отказ.
 * Одна запись аудита.
 */
export async function sendAnnouncement(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<SendAnnouncementResponse> {
  const user = await requireOfficerPermission(deps, actor, 'broadcasts.send')
  const input = parseBody(sendAnnouncementSchema, body)
  for (const channel of input.channels) {
    CHANNELS[channel].require(deps)
  }
  if (input.eventId && input.groupId) {
    throw new ApiError('validation_failed', { groupId: 'invalid' })
  }
  // Анонс группы: группа незакрытого события, без кнопок (TGM-12, Q-104).
  const group = input.groupId
    ? await groupRepository.findGroup(deps.db, input.groupId)
    : null
  if (input.groupId && !group) {
    throw new ApiError('state_conflict', { reason: 'group_missing' })
  }
  const groupEvent = group
    ? await eventRepository.find(deps.db, group.event_id)
    : null
  if (group && (!groupEvent || groupEvent.closed_at)) {
    throw new ApiError('state_conflict', { reason: 'closed' })
  }
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
  // Анонс постоянного события — с картинкой: текст короче (TGM-28, Q-114).
  const preset = event?.recurring_preset ?? null
  if (preset && input.body.length > BROADCAST_LIMITS.imageBody) {
    throw new ApiError('validation_failed', { body: 'too_long' })
  }
  const groupId = group?.id ?? null
  const eventId = event?.id ?? null
  const counts = await Promise.all(
    input.channels.map((channel) =>
      CHANNELS[channel].count(deps, groupId, eventId, input.excludedUserIds),
    ),
  )
  if (counts.every((count) => count === 0)) {
    if (input.excludedUserIds.length > 0) {
      throw new ApiError('state_conflict', {
        reason: 'excluded_no_recipients',
      })
    }
    // Анонс события: привязавшие есть, но все уже ответили (Q-109).
    const linked = eventId
      ? await linkedCounts(deps, input.channels, groupId, [])
      : []
    throw new ApiError('state_conflict', {
      reason: linked.some((count) => count > 0)
        ? 'all_answered'
        : 'no_recipients',
    })
  }
  const text = { subject: input.subject, body: input.body }
  // Каналы независимы (разные боты и лимиты) — отправка параллельно;
  // канал без получателей пропускается (MAX-09).
  const results = await Promise.all(
    input.channels.map((channel, index) =>
      counts[index]! > 0
        ? CHANNELS[channel].deliver(
            deps,
            text,
            eventId,
            groupId,
            input.excludedUserIds,
            preset,
          )
        : EMPTY_DELIVERY,
    ),
  )
  const channels: Partial<Record<SendableChannel, ChannelDelivery>> =
    Object.fromEntries(
      input.channels.map((channel, index) => [channel, results[index]!]),
    )
  const totals = results.reduce<ChannelDelivery>(
    (sum, item) => ({
      recipients: sum.recipients + item.recipients,
      sent: sum.sent + item.sent,
      failed: sum.failed + item.failed,
    }),
    EMPTY_DELIVERY,
  )
  const perChannel = Object.fromEntries(
    input.channels.flatMap((channel, index) => [
      [`${channel}_sent`, results[index]!.sent],
      [`${channel}_failed`, results[index]!.failed],
    ]),
  )
  const names = joinNames(input.channels.map((c) => CHANNELS[c].name))
  await withTransaction(deps.db, (tx) =>
    writeAudit(tx, {
      category: 'broadcast',
      action: 'broadcast_sent',
      summary: `${event ? 'Отправка анонса события' : group ? 'Отправка анонса группы' : 'Отправка анонса'} в ${names}`,
      actor: auditPerson(user),
      ...(event ? { target: { kind: 'event', id: event.id } } : {}),
      // Как действия с группами: запись указывает на событие группы.
      ...(group ? { target: { kind: 'event', id: group.event_id } } : {}),
      details: {
        title: input.subject,
        event_id: event?.id ?? group?.event_id ?? null,
        source_kind: event ? 'event' : group ? 'group' : null,
        ...(group ? { group_id: group.id } : {}),
        channels: input.channels,
        recipients: totals.recipients,
        excluded_recipients: input.excludedUserIds.length,
        sent: totals.sent,
        failed: totals.failed,
        ...perChannel,
      },
    }),
  )
  return { ...totals, channels }
}
