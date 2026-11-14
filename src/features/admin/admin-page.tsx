import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { ACCOUNT_SORTS, SORT_DIRECTIONS } from '@contracts/accounts'
import { AUDIT_CATEGORIES } from '@contracts/audit'
import { PageHeader } from '@/components/states/page-header'
import { Card } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AccountsPanel } from './accounts-panel'
import { AuditPanel } from './audit-panel'
import type { AccountsQuery, AuditQuery } from './query-keys'

/**
 * Параметры адреса: вкладка, поиск и сортировка аккаунтов, раздел и поиск
 * журнала — ссылка и «назад» сохраняют выбор.
 */
export const adminSearchSchema = z.object({
  tab: z.enum(['accounts', 'audit']).catch('accounts'),
  q: z.string().max(100).catch(''),
  sort: z.enum(ACCOUNT_SORTS).catch('nickname'),
  dir: z.enum(SORT_DIRECTIONS).catch('asc'),
  category: z.enum(AUDIT_CATEGORIES).optional().catch(undefined),
  aq: z.string().max(100).catch(''),
})
export type AdminSearch = z.output<typeof adminSearchSchema>

/** «Администрирование»: аккаунты и журнал действий (ADM, только админ). */
export function AdminPage(props: Partial<AdminSearch>) {
  // Пропущенные параметры адреса получают значения по умолчанию схемы.
  const search = adminSearchSchema.parse(props)
  const navigate = useNavigate()
  const go = useCallback(
    (next: Partial<AdminSearch>) =>
      void navigate({
        to: '/admin',
        search: (previous: Partial<AdminSearch>) => ({
          ...adminSearchSchema.parse(previous),
          ...next,
        }),
        replace: true,
      }),
    [navigate],
  )
  const accountsQuery: AccountsQuery = {
    search: search.q,
    sort: search.sort,
    direction: search.dir,
  }
  const auditQuery: AuditQuery = {
    category: search.category ?? null,
    search: search.aq,
  }

  return (
    <section>
      <PageHeader
        title="Администрирование"
        description="Аккаунты: поиск, роли, пароль и удаление. Журнал важных действий."
      />
      <Tabs
        value={search.tab}
        onValueChange={(tab) =>
          go({ tab: tab === 'audit' ? 'audit' : 'accounts' })
        }
      >
        <TabsList aria-label="Администрирование" className="mb-4">
          <TabsTrigger value="accounts">Аккаунты</TabsTrigger>
          <TabsTrigger value="audit">Журнал действий</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="grid gap-4 max-[900px]:border-0 max-[900px]:bg-none max-[900px]:p-0">
        {search.tab === 'audit' ? (
          <AuditPanel
            query={auditQuery}
            onQueryChange={(query) =>
              go({ category: query.category ?? undefined, aq: query.search })
            }
          />
        ) : (
          <AccountsPanel
            query={accountsQuery}
            onQueryChange={(query) =>
              go({ q: query.search, sort: query.sort, dir: query.direction })
            }
          />
        )}
      </Card>
    </section>
  )
}
