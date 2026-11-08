import { createRoute } from '@tanstack/react-router'
import { UserRound } from 'lucide-react'
import { EmptyState } from '@/components/states/empty-state'
import { PageHeader } from '@/components/states/page-header'
import { rootRoute } from './root'

function AccountPage() {
  return (
    <section>
      <PageHeader
        title="Аккаунт"
        description="Вход, регистрация и личный кабинет появятся на следующем этапе."
      />
      <EmptyState
        icon={<UserRound size={22} />}
        title="Раздел в разработке"
        description="Скоро здесь можно будет войти в аккаунт и посмотреть профиль персонажа."
      />
    </section>
  )
}

export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: AccountPage,
})
