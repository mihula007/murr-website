import { z } from 'zod'
import type { AccessRole } from './account.ts'
import type { CharacterStatFields } from './character-stats.ts'
import { pageRequestShape, type MemberList, type Page } from './paging.ts'

/** Численность текущего состава (member + officer + admin) — видна всем. */
export type RosterCountResponse = { count: number }

/**
 * Карточка состава: только ник, класс, аватар и роль (ROS-02). Имя, email,
 * город, дата рождения, рассказ и ссылки не отдаются (ROS-03).
 */
export type RosterMember = CharacterStatFields & {
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

/** Численность состава и распределение по классам — на сервере (ROS-05). */
export type RosterStatsResponse = {
  total: number
  classes: RosterClassStat[]
}

/**
 * Весь текущий состав по нику одним ответом (Q-48): фильтр класса и поиск
 * выполняет клиент.
 */
export type RosterListResponse = MemberList<RosterMember>

/** Страница чтецов для восстановления (ACL-06, ADM-09). */
export const readersListSchema = z.object(pageRequestShape)
export type RosterReadersRequest = z.input<typeof readersListSchema>
export type RosterReadersResponse = Page<RosterMember>
