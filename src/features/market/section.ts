import {
  MARKET_CATEGORIES,
  MARKET_CATEGORY_LABELS,
  type MarketCategory,
} from '@contracts/market'
import { INTERNAL_ROLES } from '@/app/access'
import type { MaterialSection } from '@/features/content/section'
import { marketKeys } from './query-keys'

/** Раздел «Внутри клана» (MKT): объявления создают все участники (Q-04). */
export const marketSection: MaterialSection<MarketCategory> = {
  kind: 'market',
  path: '/market',
  keys: marketKeys,
  categories: MARKET_CATEGORIES,
  categoryLabels: MARKET_CATEGORY_LABELS,
  creators: INTERNAL_ROLES,
  withFiles: false,
  withAuthorToggle: false,
  texts: {
    eyebrow: 'Сообщество',
    title: 'Внутри клана',
    description:
      'Торговые объявления участников: продажа, покупка, обмен и услуги. Цену и контакт укажите в тексте.',
    create: 'Новое объявление',
    newTitle: 'Новое объявление',
    editTitle: 'Редактирование объявления',
    item: 'объявление',
    emptyPublished: 'Объявлений пока нет.',
    emptyDrafts: 'Черновиков нет.',
    deleteDescription:
      'Объявление и его обсуждение будут удалены без возможности восстановления.',
  },
}
