import { createRoute } from '@tanstack/react-router'
import { UserRound } from 'lucide-react'
import { ROLE_LABELS, useAccess } from '@/app/access'
import { EmptyState } from '@/components/states/empty-state'
import { PageHeader } from '@/components/states/page-header'
import { rootRoute } from './root'

/** Заглушка кабинета без ограничения ролей: вход и профиль — этап 3. */
function AccountPage() {
  const { role } = useAccess()
  const isGuest = role === 'guest'
  return (
    <section>
      <PageHeader
        title={isGuest ? 'Вход' : 'Личный кабинет'}
        description={
          isGuest
            ? 'Вход и регистрация появятся на следующем этапе.'
            : `Роль: ${ROLE_LABELS[role]}.`
        }
      />
      <EmptyState
        icon={<UserRound size={22} />}
        title="Раздел в разработке"
        description={
          isGuest
            ? 'Скоро здесь можно будет войти в аккаунт или создать новый.'
            : 'Скоро здесь появятся профиль персонажа и смена пароля.'
        }
      />
    </section>
  )
}

export const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: AccountPage,
})
