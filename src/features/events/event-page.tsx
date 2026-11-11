import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { linkButtonClass } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEvent } from './api'
import { EventCard } from './event-card'
import { EventGroupsSection } from './groups/event-groups'

/** Страница события: карточка, участники и группы (EVT-06, GRP). */
export function EventPage({ id }: { id: string }) {
  const navigate = useNavigate()
  const event = useEvent(id)

  let content
  if (event.isPending) {
    content = <LoadingState label="Загружаем событие…" />
  } else if (event.isError) {
    content =
      event.error.code === 'not_found' ? (
        <ErrorState
          title="Событие не найдено"
          message="Возможно, его удалили или ссылка устарела."
        />
      ) : (
        <ErrorState onRetry={() => void event.refetch()} />
      )
  } else {
    const data = event.data
    content = (
      <div className="grid gap-4">
        <EventCard
          className="mx-auto w-full max-w-[720px]"
          event={data}
          onDeleted={() =>
            void navigate({ to: '/events', search: { tab: 'active' } })
          }
        />
        <EventGroupsSection event={data} />
      </div>
    )
  }

  return (
    <section>
      <Link
        to="/events"
        search={{ tab: 'active' }}
        className={cn(linkButtonClass, 'mb-3 inline-flex items-center gap-1.5')}
      >
        <ArrowLeft size={16} aria-hidden="true" /> К расписанию
      </Link>
      <PageHeader eyebrow="Клан" title="Событие" />
      {content}
    </section>
  )
}
