import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus, Search, X } from 'lucide-react'
import { z } from 'zod'
import { MATERIAL_LIMITS, MATERIAL_TABS } from '@contracts/materials'
import { SMALL_LIST_LIMIT } from '@contracts/paging'
import { hasRole, useAccess } from '@/app/access'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MaterialCard } from './material-card'
import { useMaterialList } from './materials-api'
import type { MaterialSection } from './section'

const ALL = 'all'

/** Параметры адреса ленты: вкладка, страница (Q-55), категория, поиск. */
export const materialSearchSchema = z.object({
  tab: z.enum(MATERIAL_TABS).catch('published'),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  category: z.string().max(32).optional().catch(undefined),
  q: z.string().max(MATERIAL_LIMITS.search).optional().catch(undefined),
})
export type MaterialSearch = z.output<typeof materialSearchSchema>

const matches = (
  section: MaterialSection,
  item: { title: string; excerpt: string; category: string },
  query: string,
) =>
  [item.title, item.excerpt, section.categoryLabels[item.category] ?? '']
    .join(' ')
    .toLowerCase()
    .includes(query.toLowerCase())

/**
 * Лента раздела (PUB-01, PUB-09, MKT-11): опубликованные — нумерованные
 * страницы по 50 с поиском на сервере (Q-55); черновики — до 50, фильтр
 * и поиск на клиенте.
 */
export function MaterialFeedPage({
  section,
  search,
}: {
  section: MaterialSection
  search: Partial<MaterialSearch>
}) {
  const navigate = useNavigate()
  const { role } = useAccess()
  const tab = search.tab ?? 'published'
  const page = search.page ?? 1
  const category = section.categories.includes(search.category ?? '')
    ? (search.category ?? null)
    : null
  const query = search.q?.trim() || null
  const drafts = tab === 'drafts'
  const list = useMaterialList(
    section,
    drafts ? { tab } : { tab, page, category, search: query },
  )
  const [draftQuery, setDraftQuery] = useState(query ?? '')
  const canCreate = hasRole(role, section.creators)

  const go = (next: Partial<MaterialSearch>) =>
    void navigate({
      to: section.path,
      search: {
        tab,
        page: 1,
        category: category ?? undefined,
        q: query ?? undefined,
        ...next,
      },
    })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    go({ q: draftQuery.trim() || undefined })
  }
  const reset = () => {
    setDraftQuery('')
    go({ q: undefined, category: undefined })
  }

  const items = (list.data?.items ?? []).filter(
    (item) =>
      !drafts ||
      ((!category || item.category === category) &&
        (!query || matches(section, item, query))),
  )
  const filtered = Boolean(query || category)

  let content
  if (list.isPending) {
    content = <LoadingState label="Загружаем материалы…" />
  } else if (list.isError) {
    content = <ErrorState onRetry={() => void list.refetch()} />
  } else if (items.length === 0) {
    content = filtered ? (
      <EmptyState
        title="Ничего не найдено"
        description="Измените запрос или сбросьте поиск, чтобы увидеть всю ленту."
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            Сбросить поиск
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={
          drafts ? section.texts.emptyDrafts : section.texts.emptyPublished
        }
      />
    )
  } else {
    content = (
      <>
        <ul
          aria-label={drafts ? 'Черновики' : section.texts.title}
          className="m-0 grid list-none gap-3 p-0"
        >
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <MaterialCard section={section} item={item} />
            </li>
          ))}
        </ul>
        {drafts && list.data.truncated ? (
          <output className="mt-3 block text-sm text-muted-foreground">
            Показаны {SMALL_LIST_LIMIT} последних черновиков. Опубликуйте или
            удалите старые, чтобы увидеть остальные.
          </output>
        ) : null}
        {!drafts ? (
          <Pagination
            className="mt-4"
            page={list.data.page}
            pageCount={list.data.pageCount}
            onPageChange={(next) => go({ page: next })}
          />
        ) : null}
      </>
    )
  }

  const categoryOptions = [
    { value: ALL, label: 'Все категории' },
    ...section.categories.map((value) => ({
      value,
      label: section.categoryLabels[value] ?? value,
    })),
  ]

  return (
    <section>
      <PageHeader
        eyebrow={section.texts.eyebrow}
        title={section.texts.title}
        description={section.texts.description}
        actions={
          canCreate ? (
            <Link
              to={`${section.path}/new`}
              className={buttonVariants({ className: 'no-underline' })}
            >
              <Plus size={18} aria-hidden="true" /> {section.texts.create}
            </Link>
          ) : null
        }
      />
      {canCreate ? (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            go({ tab: value === 'drafts' ? 'drafts' : 'published' })
          }
        >
          <TabsList aria-label={section.texts.title} className="mb-4">
            <TabsTrigger value="published">Опубликованные</TabsTrigger>
            <TabsTrigger value="drafts">Черновики</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      <search aria-label="Поиск по ленте">
        <form
          className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]"
          onSubmit={submit}
        >
          <div className="relative min-w-0">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Поиск"
              className="pl-9"
              placeholder="Заголовок, текст, автор, категория"
              maxLength={MATERIAL_LIMITS.search}
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
          </div>
          <Select
            aria-label="Категория"
            options={categoryOptions}
            value={category ?? ALL}
            onValueChange={(value) =>
              go({ category: value === ALL ? undefined : value })
            }
          />
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">
              Найти
            </Button>
            {filtered ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Сбросить поиск"
                onClick={reset}
              >
                <X aria-hidden className="size-4" />
              </Button>
            ) : null}
          </div>
        </form>
      </search>
      {content}
    </section>
  )
}
