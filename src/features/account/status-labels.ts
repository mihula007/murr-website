import type { AccessRole, ApplicationStatus } from '@contracts/account'

/** Тексты статусов из прототипа (renderAccountDashboard). */
export const APPLICATION_STATUS: Record<
  ApplicationStatus,
  { label: string; notice: string }
> = {
  pending_officer_review: {
    label: 'Ожидает проверки офицера',
    notice: 'Заявка получена и ожидает проверки офицером клана.',
  },
  pending_vote: {
    label: 'На голосовании гильдии',
    notice:
      'Заявка отправлена на голосование. Ты можешь отслеживать её статус здесь, но не видишь внутренние обсуждения и голоса участников.',
  },
  officer_approved: {
    label: 'Заявка подтверждена офицером',
    notice:
      'Офицер подтвердил заявку без голосования. Доступ участника активирован.',
  },
  officer_rejected: {
    label: 'Заявка отклонена офицером',
    notice:
      'Офицер отклонил заявку. Если это ошибка, можно связаться с администрацией.',
  },
  admin_approved: {
    label: 'Заявка принята после голосования',
    notice: 'Заявка принята после голосования. Добро пожаловать в клан!',
  },
  admin_rejected: {
    label: 'Заявка отклонена после голосования',
    notice: 'Заявка отклонена после голосования.',
  },
}

export const ROLE_STATUS: Record<Exclude<AccessRole, 'applicant'>, string> = {
  admin: 'Администратор',
  officer: 'Офицер клана',
  member: 'Принят в клан',
  reader: 'Чтец · доступ только к профилю',
}
