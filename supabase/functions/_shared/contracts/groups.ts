import { z } from 'zod'
import { SMALL_LIST_LIMIT } from './paging.ts'

/** Ограничения групп и шаблонов групп (GRP-03, GRP-12, GRP-13). */
export const GROUP_LIMITS = {
  name: 40,
  templateName: 60,
  /** Группы события и шаблона — малый список (реестр списков). */
  groups: SMALL_LIST_LIMIT,
  /** Не больше 20 шаблонов групп (GRP-12). */
  templates: 20,
} as const

/** Итог посещения закрытого события (таблица 11-activity, ACT-01). */
export const ATTENDANCE_STATUSES = ['visited', 'missed', 'unmarked'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  visited: 'Посетил',
  missed: 'Не посетил',
  unmarked: 'Не отметился',
}

const groupNameSchema = z
  .string('required')
  .trim()
  .min(1, 'required')
  .max(GROUP_LIMITS.name, 'too_long')

/** Поле названия группы в формах создания и переименования. */
export const groupNameFormSchema = z.object({ name: groupNameSchema })
export type GroupNameForm = z.input<typeof groupNameFormSchema>

export const createGroupSchema = z.object({
  eventId: z.guid('not_found'),
  name: groupNameSchema,
})
export type CreateGroupRequest = z.input<typeof createGroupSchema>

export const renameGroupSchema = z.object({
  groupId: z.guid('not_found'),
  name: groupNameSchema,
})
export type RenameGroupRequest = z.input<typeof renameGroupSchema>

export const groupIdSchema = z.object({ groupId: z.guid('not_found') })
export type GroupIdRequest = z.input<typeof groupIdSchema>

/**
 * Перенос участника (GRP-04–07): в группу на позицию (нет — в конец),
 * между группами, внутри группы или в пул (`groupId: null`).
 */
export const moveMemberSchema = z.object({
  eventId: z.guid('not_found'),
  userId: z.guid('not_found'),
  groupId: z
    .guid('not_found')
    .nullish()
    .transform((value) => value ?? null),
  position: z
    .number()
    .int()
    .min(0)
    .nullish()
    .transform((value) => value ?? null),
})
export type MoveMemberRequest = z.input<typeof moveMemberSchema>

/** Лидер из участников группы или «Без лидера» (`userId: null`, GRP-08). */
export const setLeaderSchema = z.object({
  groupId: z.guid('not_found'),
  userId: z
    .guid('not_found')
    .nullish()
    .transform((value) => value ?? null),
})
export type SetLeaderRequest = z.input<typeof setLeaderSchema>

/**
 * Шаблон групп из конструктора или из события (GRP-13, GRP-14): название,
 * минимум одна группа, участник — в одной группе, лидер — не больше одного
 * в группе.
 */
export const saveGroupTemplateSchema = z
  .object({
    name: z
      .string('required')
      .trim()
      .min(1, 'required')
      .max(GROUP_LIMITS.templateName, 'too_long'),
    groups: z
      .array(
        z.object({
          name: groupNameSchema,
          members: z
            .array(
              z.object({
                userId: z.guid('invalid'),
                isLeader: z.boolean(),
              }),
            )
            .max(500, 'too_many'),
        }),
        'required',
      )
      .min(1, 'required')
      .max(GROUP_LIMITS.groups, 'too_many'),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.groups.forEach((group, index) => {
      if (group.members.filter((member) => member.isLeader).length > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, 'members'],
          message: 'one_leader',
        })
      }
      for (const member of group.members) {
        if (seen.has(member.userId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['groups'],
            message: 'duplicate_member',
          })
        }
        seen.add(member.userId)
      }
    })
  })
export type SaveGroupTemplateRequest = z.input<typeof saveGroupTemplateSchema>

export const groupTemplateIdSchema = z.object({ id: z.guid('not_found') })

export const applyGroupTemplateSchema = z.object({
  eventId: z.guid('not_found'),
  templateId: z.guid('not_found'),
})
export type ApplyGroupTemplateRequest = z.input<typeof applyGroupTemplateSchema>

/** Участник группы события по порядку (GRP-07). */
export type EventGroupMember = { userId: string; isLeader: boolean }

export type EventGroup = {
  id: string
  name: string
  members: EventGroupMember[]
}

/** Группы события после изменения — без повторного чтения участников. */
export type EventGroupsResponse = { groups: EventGroup[] }

export type GroupTemplateMember = {
  userId: string
  gameNickname: string
  classId: number
  className: string
  isLeader: boolean
}

export type GroupTemplate = {
  id: string
  name: string
  createdBy: { gameNickname: string } | null
  groups: { name: string; members: GroupTemplateMember[] }[]
}

export type GroupTemplatesResponse = { items: GroupTemplate[] }
