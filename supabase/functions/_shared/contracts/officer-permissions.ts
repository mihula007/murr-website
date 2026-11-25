import { z } from 'zod'

export const OFFICER_PERMISSION_CODES = [
  'applications.review',
  'applications.submit_vote',
  'applications.decide_after_vote',
  'applications.decide_direct',
  'broadcasts.send',
  'broadcasts.templates',
  'broadcasts.subscriptions',
  'events.manage',
  'events.view_full_roster',
  'events.templates',
  'events.delete_own',
  'groups.manage',
  'groups.templates',
  'events.close',
  'votes.manage',
  'votes.complete_delete',
  'votes.view_ballots',
  'roster.reader_roles',
  'activity.view_export',
  'activity.correct_rating',
  'activity.correct_summary',
  'publications.manage_own',
] as const

export type OfficerPermissionCode = (typeof OFFICER_PERMISSION_CODES)[number]

export const OFFICER_PERMISSION_LABELS: Record<OfficerPermissionCode, string> =
  {
    'applications.review': 'Разбирать новые заявки',
    'applications.submit_vote': 'Передавать заявку на голосование',
    'applications.decide_after_vote': 'Принимать решение после голосования',
    'applications.decide_direct': 'Принимать решение без голосования',
    'broadcasts.send': 'Создавать и отправлять рассылки',
    'broadcasts.templates': 'Управлять общими шаблонами рассылок',
    'broadcasts.subscriptions': 'Просматривать подписки',
    'events.manage': 'Создавать и редактировать ивенты',
    'events.view_full_roster':
      'Просматривать полный состав участников и группы ивента',
    'events.templates': 'Управлять шаблонами ивентов',
    'events.delete_own': 'Удалять свои незакрытые ивенты',
    'groups.manage': 'Создавать группы и распределять участников',
    'groups.templates': 'Управлять шаблонами групп',
    'events.close': 'Закрывать ивенты и фиксировать посещаемость',
    'votes.manage': 'Создавать и редактировать голосования',
    'votes.complete_delete': 'Завершать и удалять голосования',
    'votes.view_ballots': 'Просматривать, кто как проголосовал',
    'roster.reader_roles':
      'Присваивать роль чтеца и возвращать чтеца в члены клана',
    'activity.view_export':
      'Просматривать учёт активности, сводки и выгружать Excel',
    'activity.correct_rating': 'Корректировать рейтинг посещения',
    'activity.correct_summary': 'Корректировать сводку учёта активности',
    'publications.manage_own': 'Управлять своими публикациями',
  }

export const officerPermissionCodeSchema = z.enum(OFFICER_PERMISSION_CODES)

export const officerPermissionsSaveSchema = z.object({
  officerId: z.uuid(),
  permissions: z
    .array(officerPermissionCodeSchema)
    .max(OFFICER_PERMISSION_CODES.length)
    .refine((values) => new Set(values).size === values.length, 'duplicate'),
})

export type OfficerPermissionsSaveRequest = z.input<
  typeof officerPermissionsSaveSchema
>

export type OfficerPermissionsResponse = {
  officer: { id: string; nickname: string }
  permissions: OfficerPermissionCode[]
}

export type OfficerPermissionsRosterResponse = {
  officers: Array<
    OfficerPermissionsResponse['officer'] & {
      permissions: OfficerPermissionCode[]
    }
  >
}
