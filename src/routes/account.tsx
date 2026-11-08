import { createRoute, Navigate } from '@tanstack/react-router'
import { UserRound } from 'lucide-react'
import { ROLE_LABELS, useAccess } from '@/app/access'
import { EmptyState } from '@/components/states/empty-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { rootRoute } from './root'

/** Кабинет: гостя ведёт ко входу, незавершённую регистрацию — к её завершению. */
function AccountPage() {
  const { role, status } = useAccess()
  if (status === 'loading') return <LoadingState label="Загружаем аккаунт…" />
  if (status === 'guest') return <Navigate to="/login" />
  if (status === 'incomplete') return <Navigate to="/register/complete" />
  return (
    <section>
      <PageHeader
        title="Личный кабинет"
        description={`Роль: ${ROLE_LABELS[role]}.`}
      />
      <EmptyState
        icon={<UserRound size={22} />}
        title="Раздел в разработке"
        description="Скоро здесь появятся профиль персонажа и смена пароля."
      />
    </section>
  )
}

export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: AccountPage,
})
