import type { ReactNode } from 'react'
import { PageHeader } from '@/components/states/page-header'
import { Card, Notice } from '@/components/ui/surfaces'
import { useSession } from '@/features/auth/session'

type AuthPageProps = {
  title: string
  description?: ReactNode
  children: ReactNode
}

/** Страница входа/регистрации: заголовок и карточка 620 px, как карточка входа прототипа. */
export function AuthPage({ title, description, children }: AuthPageProps) {
  const session = useSession()
  return (
    <section>
      <PageHeader title={title} description={description} />
      <Card className="mx-auto grid w-full max-w-[620px] gap-4">
        {session.status === 'unavailable' ? (
          <Notice>
            Вход временно недоступен: сайт ещё не подключён к серверу.
          </Notice>
        ) : null}
        {children}
      </Card>
    </section>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Notice role="alert" className="border-destructive text-destructive">
      {message}
    </Notice>
  )
}
