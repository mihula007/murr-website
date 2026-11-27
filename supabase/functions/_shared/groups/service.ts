import type { AppDeps } from '../app.ts'
import { avatarUrls } from '../account/avatars.ts'
import { auditPerson, writeAudit } from '../audit/service.ts'
import type { Actor } from '../auth/actor.ts'
import {
  hasOfficerPermission,
  requireOfficerPermission,
} from '../officer-permissions/service.ts'
import {
  applyGroupTemplateSchema,
  createGroupSchema,
  GROUP_LIMITS,
  groupIdSchema,
  groupTemplateIdSchema,
  moveMemberSchema,
  renameGroupSchema,
  saveGroupTemplateSchema,
  setLeaderSchema,
  groupPoolPageRequestSchema,
  groupPoolCursorSchema,
  type GroupPoolPageResponse,
  type EventGroupsResponse,
  type GroupTemplateCatalogResponse,
  type GroupTemplate,
  type GroupTemplatesResponse,
} from '../contracts/groups.ts'
import { withTransaction, type Executor } from '../db/client.ts'
import { eventGroups, lockOpen } from '../events/service.ts'
import { eventRepository } from '../events/repository.ts'
import { ApiError } from '../http/errors.ts'
import { decodeCursor, splitPage } from '../http/cursor.ts'
import { parseBody } from '../http/validation.ts'
import { INTERNAL_ROLES } from '../membership.ts'
import { notify } from '../notifications/service.ts'
import { groupRepository } from './repository.ts'

/*
 * Группы (пати) актуального события (GRP-01–16). Меняют офицер и
 * администратор. Каждая операция блокирует строку события `FOR UPDATE`:
 * изменения групп одного события идут по очереди (позиции не сталкиваются),
 * а закрытие, которое берёт ту же блокировку, видит окончательный состав.
 * Закрытое событие — `state_conflict` (GRP-16). В аудит не пишутся (Q-54).
 */

type EventRef = { id: string; title: string }

/**
 * Уведомления участнику о группе события (NTF-03): «добавлен в группу» и
 * «назначен пати-лидером». Источник — событие: перенос между группами и
 * повтор не создают второго уведомления; себе — не уведомляет (NTF-04).
 */
async function notifyGroup(
  tx: Executor,
  actorId: string,
  event: EventRef,
  kind: 'group_added' | 'group_leader',
  userId: string,
  groupName: string,
) {
  const target = { kind: 'event', id: event.id }
  await notify(tx, {
    recipientId: userId,
    actorId,
    kind,
    title:
      kind === 'group_added'
        ? 'Вы добавлены в группу'
        : 'Вы назначены пати-лидером',
    body: `${event.title} · ${groupName}`,
    target,
    source: target,
  })
}

const isInternal = (role: string | undefined) =>
  role !== undefined && (INTERNAL_ROLES as readonly string[]).includes(role)

const poolCursor = groupPoolCursorSchema

/** Курсорный свободный список актуального события с полными числами вкладок. */
export async function groupPoolPage(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<GroupPoolPageResponse> {
  await requireOfficerPermission(deps, actor, 'events.view_full_roster')
  const input = parseBody(groupPoolPageRequestSchema, body)
  const event = await eventRepository.find(deps.db, input.eventId)
  if (!event) {
    throw new ApiError('not_found')
  }
  if (event.closed_at) {
    throw new ApiError('state_conflict')
  }
  const after = input.cursor ? decodeCursor(poolCursor, input.cursor) : null
  const [rows, counts] = await Promise.all([
    groupRepository.poolPage(deps.db, {
      eventId: input.eventId,
      roles: INTERNAL_ROLES,
      tab: input.tab,
      ...(input.classIds ? { classIds: input.classIds } : {}),
      sortBy: input.sortBy,
      direction: input.direction,
      after: after as [string | null, string, string] | null,
      limit: input.limit + 1,
    }),
    groupRepository.poolCounts(deps.db, input.eventId, INTERNAL_ROLES),
  ])
  const page = splitPage(rows, input.limit, (row) =>
    input.sortBy
      ? [
          row[input.sortBy] == null ? null : String(row[input.sortBy]),
          row.game_nickname,
          row.id,
        ]
      : [null, row.game_nickname, row.id],
  )
  const urls = await avatarUrls(
    deps.storage,
    page.rows.map((row) => row.avatar_path),
  )
  return {
    items: page.rows.map((row) => ({
      id: row.id,
      gameNickname: row.game_nickname,
      classId: row.class_id,
      className: row.class_name,
      avatarUrl: row.avatar_path ? (urls.get(row.avatar_path) ?? null) : null,
      pa: row.pa == null ? null : Number(row.pa),
      pz: row.pz == null ? null : Number(row.pz),
      bu: row.bu == null ? null : Number(row.bu),
      hp: row.hp == null ? null : Number(row.hp),
      bd: row.bd == null ? null : Number(row.bd),
      answer: (row.answer as 'yes' | 'no' | 'maybe' | null) ?? null,
      status: null,
    })),
    nextCursor: page.nextCursor,
    counts,
  }
}

async function groupsResponse(
  deps: AppDeps,
  db: Executor,
  eventId: string,
): Promise<EventGroupsResponse> {
  return { groups: await eventGroups(deps, db, eventId) }
}

/** Группа незакрытого события под блокировкой события. */
async function lockGroup(tx: Executor, groupId: string) {
  const group = await groupRepository.findGroup(tx, groupId)
  if (!group) {
    throw new ApiError('not_found')
  }
  const event = await lockOpen(tx, group.event_id, 'update')
  // Группу могли удалить, пока ждали блокировку события.
  if (!(await groupRepository.findGroup(tx, groupId))) {
    throw new ApiError('not_found')
  }
  return { group, event }
}

/** Новая группа в конце списка (GRP-03). */
export async function createGroup(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventGroupsResponse> {
  await requireOfficerPermission(deps, actor, 'groups.manage')
  const input = parseBody(createGroupSchema, body)
  return withTransaction(deps.db, async (tx) => {
    await lockOpen(tx, input.eventId, 'update')
    if (
      (await groupRepository.countGroups(tx, input.eventId)) >=
      GROUP_LIMITS.groups
    ) {
      throw new ApiError('validation_failed', { limit: 'too_many' })
    }
    await groupRepository.createGroup(tx, {
      eventId: input.eventId,
      name: input.name,
    })
    return groupsResponse(deps, tx, input.eventId)
  })
}

/** Переименование группы (GRP-09). */
export async function renameGroup(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventGroupsResponse> {
  await requireOfficerPermission(deps, actor, 'groups.manage')
  const input = parseBody(renameGroupSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const { group } = await lockGroup(tx, input.groupId)
    await groupRepository.renameGroup(tx, group.id, input.name)
    return groupsResponse(deps, tx, group.event_id)
  })
}

/** Удаление группы: люди возвращаются в пул, ответы не меняются (GRP-09). */
export async function deleteGroup(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventGroupsResponse> {
  await requireOfficerPermission(deps, actor, 'groups.manage')
  const { groupId } = parseBody(groupIdSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const { group } = await lockGroup(tx, groupId)
    await groupRepository.deleteGroup(tx, group.id)
    return groupsResponse(deps, tx, group.event_id)
  })
}

/**
 * Перенос участника (GRP-04–08): в группу на позицию, между группами,
 * внутри группы (порядок) или в пул. Назначить можно только текущий
 * состав с любым ответом или без (GRP-05); вернуть в пул — любого.
 * Лидерство сохраняется только при перестановке внутри той же группы.
 */
export async function moveMember(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventGroupsResponse> {
  const manager = await requireOfficerPermission(deps, actor, 'groups.manage')
  const input = parseBody(moveMemberSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const event = await lockOpen(tx, input.eventId, 'update')
    const group =
      input.groupId === null
        ? null
        : await groupRepository.findGroup(tx, input.groupId)
    if (input.groupId !== null) {
      if (!group || group.event_id !== input.eventId) {
        throw new ApiError('not_found')
      }
    }
    const current = await groupRepository.membership(
      tx,
      input.eventId,
      input.userId,
    )
    if (input.groupId !== null && !current) {
      const roles = await groupRepository.rolesOf(tx, [input.userId])
      if (!isInternal(roles.get(input.userId))) {
        throw new ApiError('validation_failed', { userId: 'not_member' })
      }
    }
    if (current) {
      await groupRepository.removeMember(tx, input.eventId, input.userId)
      await groupRepository.shiftPositions(
        tx,
        current.group_id,
        current.position + 1,
        -1,
      )
    }
    if (input.groupId !== null) {
      const size = await groupRepository.groupSize(tx, input.groupId)
      const position = Math.min(input.position ?? size, size)
      await groupRepository.shiftPositions(tx, input.groupId, position, 1)
      await groupRepository.insertMember(tx, {
        eventId: input.eventId,
        groupId: input.groupId,
        userId: input.userId,
        position,
        isLeader: current?.group_id === input.groupId && current.is_leader,
      })
      if (!current && group) {
        await notifyGroup(
          tx,
          manager.userId,
          event,
          'group_added',
          input.userId,
          group.name,
        )
      }
    }
    return groupsResponse(deps, tx, input.eventId)
  })
}

/** Лидер из участников этой группы или «Без лидера» (GRP-08). */
export async function setGroupLeader(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventGroupsResponse> {
  const manager = await requireOfficerPermission(deps, actor, 'groups.manage')
  const input = parseBody(setLeaderSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const { group, event } = await lockGroup(tx, input.groupId)
    if (input.userId !== null) {
      const membership = await groupRepository.membership(
        tx,
        group.event_id,
        input.userId,
      )
      if (membership?.group_id !== group.id) {
        throw new ApiError('validation_failed', { userId: 'not_in_group' })
      }
    }
    await groupRepository.setLeader(tx, group.id, input.userId)
    if (input.userId !== null) {
      await notifyGroup(
        tx,
        manager.userId,
        event,
        'group_leader',
        input.userId,
        group.name,
      )
    }
    return groupsResponse(deps, tx, group.event_id)
  })
}

// --- Шаблоны групп: общая библиотека офицеров и администраторов ---

function templateTarget(id: string) {
  return { kind: 'group_template', id }
}

function toTemplate(
  row: { id: string; name: string; author_nickname: string | null },
  groups: Awaited<ReturnType<typeof groupRepository.templateGroups>>,
  members: Awaited<ReturnType<typeof groupRepository.templateMembers>>,
): GroupTemplate {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.author_nickname
      ? { gameNickname: row.author_nickname }
      : null,
    groups: groups
      .filter((group) => group.template_id === row.id)
      .map((group) => ({
        name: group.name,
        members: members
          .filter(
            (member) =>
              member.group_id === group.id && isInternal(member.access_role),
          )
          .map((member) => ({
            userId: member.user_id,
            gameNickname: member.game_nickname,
            classId: member.class_id,
            className: member.class_name,
            pa: member.pa === null ? null : Number(member.pa),
            pz: member.pz === null ? null : Number(member.pz),
            bu: member.bu === null ? null : Number(member.bu),
            hp: member.hp === null ? null : Number(member.hp),
            bd: member.bd === null ? null : Number(member.bd),
            isLeader: member.is_leader,
          })),
      })),
  }
}

/** Шаблоны с группами и участниками; выбывшие из состава не показываются. */
async function loadTemplates(db: Executor): Promise<GroupTemplate[]> {
  const rows = await groupRepository.templates(db, GROUP_LIMITS.templates)
  const ids = rows.map((row) => row.id)
  const [groups, members] = await Promise.all([
    groupRepository.templateGroups(db, ids),
    groupRepository.templateMembers(db, ids),
  ])
  return rows.map((row) =>
    toTemplate(
      row,
      groups.filter((group) => group.template_id === row.id),
      members,
    ),
  )
}

export async function listGroupTemplates(
  deps: AppDeps,
  actor: Actor,
): Promise<GroupTemplatesResponse> {
  const canManageGroups = await hasOfficerPermission(
    deps,
    actor,
    'groups.manage',
  )
  const canManageTemplates = await hasOfficerPermission(
    deps,
    actor,
    'groups.templates',
  )
  if (!canManageGroups && !canManageTemplates) {
    throw new ApiError('forbidden')
  }
  return { items: await loadTemplates(deps.db) }
}

/** Краткий каталог для нового клиента без загрузки участников всех шаблонов. */
export async function listGroupTemplateCatalog(
  deps: AppDeps,
  actor: Actor,
): Promise<GroupTemplateCatalogResponse> {
  const canManageGroups = await hasOfficerPermission(
    deps,
    actor,
    'groups.manage',
  )
  const canManageTemplates = await hasOfficerPermission(
    deps,
    actor,
    'groups.templates',
  )
  if (!canManageGroups && !canManageTemplates) {
    throw new ApiError('forbidden')
  }
  const rows = await groupRepository.templates(deps.db, GROUP_LIMITS.templates)
  const ids = rows.map((row) => row.id)
  const [groupCounts, memberCounts] = await Promise.all([
    groupRepository.templateGroupCounts(deps.db, ids),
    groupRepository.templateMemberCounts(deps.db, ids),
  ])
  const groupsByTemplate = new Map(
    groupCounts.map((row) => [row.template_id, Number(row.count)]),
  )
  const membersByTemplate = new Map(
    memberCounts.map((row) => [row.template_id, Number(row.count)]),
  )
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdBy: row.author_nickname
        ? { gameNickname: row.author_nickname }
        : null,
      groupCount: groupsByTemplate.get(row.id) ?? 0,
      memberCount: membersByTemplate.get(row.id) ?? 0,
    })),
  }
}

/** Полные сведения одного шаблона с характеристиками для редактора. */
export async function getGroupTemplate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<GroupTemplate> {
  await requireOfficerPermission(deps, actor, 'groups.templates')
  const { id } = parseBody(groupTemplateIdSchema, body)
  const row = await groupRepository.template(deps.db, id)
  if (!row) {
    throw new ApiError('not_found')
  }
  const [groups, members] = await Promise.all([
    groupRepository.templateGroups(deps.db, [id]),
    groupRepository.templateMembers(deps.db, [id]),
  ])
  return toTemplate(row, groups, members)
}

/**
 * Шаблон из конструктора или из события (GRP-13, GRP-14): копия групп,
 * порядка и лидеров, а не ссылка на событие. Участники — только текущий
 * состав. Не больше 20 (GRP-12).
 */
export async function saveGroupTemplate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<GroupTemplatesResponse> {
  const manager = await requireOfficerPermission(
    deps,
    actor,
    'groups.templates',
  )
  const input = parseBody(saveGroupTemplateSchema, body)
  const userIds = input.groups.flatMap((group) =>
    group.members.map((member) => member.userId),
  )
  await withTransaction(deps.db, async (tx) => {
    const roles = await groupRepository.rolesOf(tx, userIds)
    if (userIds.some((id) => !isInternal(roles.get(id)))) {
      throw new ApiError('validation_failed', { groups: 'not_member' })
    }
    let id = input.id
    let action = 'group_template_created'
    let summary = 'Создание шаблона групп'
    if (input.id) {
      const current = await groupRepository.lockTemplate(tx, input.id)
      if (!current) {
        throw new ApiError('not_found')
      }
      await groupRepository.updateTemplate(tx, {
        id: input.id,
        name: input.name,
        groups: input.groups,
      })
      action = 'group_template_updated'
      summary = 'Изменение шаблона групп'
    } else {
      await groupRepository.lockTemplates(tx)
      if (
        (await groupRepository.countTemplates(tx)) >= GROUP_LIMITS.templates
      ) {
        throw new ApiError('validation_failed', { limit: 'too_many' })
      }
      id = await groupRepository.createTemplate(tx, {
        name: input.name,
        createdBy: manager.userId,
        groups: input.groups,
      })
    }
    await writeAudit(tx, {
      category: 'events',
      action,
      summary,
      actor: auditPerson(manager),
      target: templateTarget(id!),
      details: { template_id: id!, title: input.name },
    })
  })
  return { items: await loadTemplates(deps.db) }
}

/** Любой шаблон общей библиотеки. */
export async function deleteGroupTemplate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<GroupTemplatesResponse> {
  const manager = await requireOfficerPermission(
    deps,
    actor,
    'groups.templates',
  )
  const { id } = parseBody(groupTemplateIdSchema, body)
  await withTransaction(deps.db, async (tx) => {
    const deleted = await groupRepository.deleteTemplate(tx, id)
    if (!deleted) {
      throw new ApiError('not_found')
    }
    await writeAudit(tx, {
      category: 'events',
      action: 'group_template_deleted',
      summary: 'Удаление шаблона групп',
      actor: auditPerson(manager),
      target: templateTarget(id),
      details: { template_id: id, title: deleted.name },
    })
  })
  return { items: await loadTemplates(deps.db) }
}

/**
 * Применение шаблона (GRP-15): заменяет распределение актуального события.
 * Включаются только ответившие «Приду» из текущего состава; лидер — только
 * если сам попал в группу. Подтверждение замены — в интерфейсе.
 */
export async function applyGroupTemplate(
  deps: AppDeps,
  actor: Actor,
  body: unknown,
): Promise<EventGroupsResponse> {
  const manager = await requireOfficerPermission(deps, actor, 'groups.manage')
  const input = parseBody(applyGroupTemplateSchema, body)
  return withTransaction(deps.db, async (tx) => {
    const event = await lockOpen(tx, input.eventId, 'update')
    const template = (await loadTemplates(tx)).find(
      (item) => item.id === input.templateId,
    )
    if (!template) {
      throw new ApiError('not_found')
    }
    const coming = await groupRepository.yesAnswers(tx, input.eventId)
    const groups = template.groups.map((group) => ({
      name: group.name,
      members: group.members
        .filter((member) => coming.has(member.userId))
        .map((member) => ({
          userId: member.userId,
          isLeader: member.isLeader,
        })),
    }))
    await groupRepository.deleteGroupsOf(tx, input.eventId)
    await groupRepository.insertGroups(tx, input.eventId, groups)
    for (const group of groups) {
      for (const member of group.members) {
        await notifyGroup(
          tx,
          manager.userId,
          event,
          'group_added',
          member.userId,
          group.name,
        )
        if (member.isLeader) {
          await notifyGroup(
            tx,
            manager.userId,
            event,
            'group_leader',
            member.userId,
            group.name,
          )
        }
      }
    }
    return groupsResponse(deps, tx, input.eventId)
  })
}
