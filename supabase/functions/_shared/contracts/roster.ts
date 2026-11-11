import type { AccessRole } from './account.ts'

/** Численность текущего состава (member + officer + admin) — видна всем. */
export type RosterCountResponse = { count: number }

/**
 * Карточка состава: только ник, класс, аватар и роль (ROS-02). Имя, email,
 * город, дата рождения, рассказ и ссылки не отдаются (ROS-03).
 */
export type RosterMember = {
  id: string
  gameNickname: string
  classId: number
  className: string
  avatarUrl: string | null
  role: AccessRole
}

/** Число участников класса; классы справочника без участников — с нулём. */
export type RosterClassStat = {
  classId: number
  className: string
  count: number
}

export type RosterListResponse = {
  members: RosterMember[]
  total: number
  classes: RosterClassStat[]
}

/** Чтецы для восстановления (ACL-06, ADM-09). */
export type RosterReadersResponse = { readers: RosterMember[] }
