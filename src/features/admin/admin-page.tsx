import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Card } from '@/components/ui/surfaces'
import { AccountsTable } from './accounts-table'
import { useAccounts } from './api'

/** «Администрирование»: на этапе 4 — таблица аккаунтов и роли (ADM-04). */
export function AdminPage() {
  const accounts = useAccounts()

  let content
  if (accounts.isPending) {
    content = <LoadingState label="Загружаем аккаунты…" />
  } else if (accounts.isError) {
    content = <ErrorState onRetry={() => void accounts.refetch()} />
  } else if (accounts.data.length === 0) {
    content = <EmptyState title="Аккаунтов нет" />
  } else {
    content = <AccountsTable accounts={accounts.data} />
  }

  return (
    <section>
      <PageHeader
        eyebrow="Управление"
        title="Администрирование"
        description="Роли аккаунтов: смена роли, блокировка (статус «Чтец») и восстановление."
      />
      <Card className="grid gap-4 max-[760px]:border-0 max-[760px]:bg-none max-[760px]:p-0">
        <h2 className="text-xl font-bold">Аккаунты</h2>
        {content}
      </Card>
    </section>
  )
}
