import type { ReactNode } from 'react'
import { PageHeader } from '@/components/states/page-header'
import { Card, Notice } from '@/components/ui/surfaces'
import { useSession } from './session'

type AuthPageProps = {
  title: string
  description?: ReactNode
  children: ReactNode
}

/** Страница входа/регистрации: заголовок и карточка одной колонкой 620 px, по одной левой границе. */
export function AuthPage({ title, description, children }: AuthPageProps) {
  const session = useSession()
  return (
    <section className="mx-auto w-full max-w-[620px]">
      <PageHeader title={title} description={description} />
      <Card className="grid gap-4">
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
