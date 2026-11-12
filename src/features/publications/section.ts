import {
  PUBLICATION_CATEGORIES,
  PUBLICATION_CATEGORY_LABELS,
  type PublicationCategory,
} from '@contracts/publications'
import { MANAGER_ROLES } from '@/app/access'
import type { MaterialSection } from '@/features/content/section'
import { publicationKeys } from './query-keys'

/** Раздел «Публикации» (PUB): создают офицеры и администраторы (Q-02). */
export const publicationsSection: MaterialSection<PublicationCategory> = {
  kind: 'publications',
  path: '/publications',
  keys: publicationKeys,
  categories: PUBLICATION_CATEGORIES,
  categoryLabels: PUBLICATION_CATEGORY_LABELS,
  creators: MANAGER_ROLES,
  withFiles: true,
  withAuthorToggle: true,
  texts: {
    eyebrow: 'Сообщество',
    title: 'Публикации',
    description: 'Статьи, объявления, новости, гайды и правила клана.',
    create: 'Новая публикация',
    newTitle: 'Новая публикация',
    editTitle: 'Редактирование публикации',
    item: 'публикацию',
    emptyPublished: 'Опубликованных материалов пока нет.',
    emptyDrafts: 'Черновиков нет.',
    deleteDescription:
      'Материал, его вложения и обсуждение будут удалены без возможности восстановления.',
  },
}
