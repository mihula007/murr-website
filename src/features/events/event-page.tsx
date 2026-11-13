import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { EventDetails } from '@contracts/events'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { linkButtonClass } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMediaQuery } from '@/components/virtual-list'
import { DiscussionThread } from '@/features/discussions/discussion-thread'
import { cn } from '@/lib/utils'
import { useEvent } from './api'
import { EventCard } from './event-card'
import { EventGroupsSection } from './groups/event-groups'

const discussionTitleClass =
  'm-0 text-xs font-extrabold tracking-[0.16em] text-primary uppercase'

/**
 * Группы и обсуждение события (DSC-01): на широком экране чат — колонкой
 * справа от групп, на узком — отдельной вкладкой, чтобы не уходить под
 * длинный список групп.
 */
function GroupsAndDiscussion({ event }: { event: EventDetails }) {
  const wide = useMediaQuery('(min-width: 64rem)')
  const thread = { parent: 'event', parentId: event.id } as const
  const count = event.messageCount ?? 0
  if (wide) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(320px,400px)] items-start gap-4">
        <EventGroupsSection event={event} />
        <Card className="sticky top-4 grid gap-3 p-4">
          <h2 className={discussionTitleClass}>Обсуждение ({count})</h2>
          <DiscussionThread
            thread={thread}
            listClassName="h-[min(60svh,560px)]"
          />
        </Card>
      </div>
    )
  }
  return (
    <Tabs defaultValue="groups">
      <TabsList aria-label="Разделы события">
        <TabsTrigger value="groups">Группы</TabsTrigger>
        <TabsTrigger value="discussion">Обсуждение ({count})</TabsTrigger>
      </TabsList>
      <TabsContent value="groups">
        <EventGroupsSection event={event} />
      </TabsContent>
      <TabsContent value="discussion">
        <DiscussionThread thread={thread} listClassName="h-[60svh]" />
      </TabsContent>
    </Tabs>
  )
}

/** Страница события: карточка, участники и группы (EVT-06, GRP). */
export function EventPage({ id }: { id: string }) {
  const navigate = useNavigate()
  const event = useEvent(id)

  let content
  if (event.isPending) {
    content = <LoadingState label="Загружаем ивент…" />
  } else if (event.isError) {
    content =
      event.error.code === 'not_found' ? (
        <ErrorState
          title="Ивент не найден"
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
          event={data}
          onDeleted={() =>
            void navigate({ to: '/events', search: { tab: 'active' } })
          }
        />
        <GroupsAndDiscussion event={data} />
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
        <ArrowLeft size={16} aria-hidden="true" /> К ивентам
      </Link>
      <PageHeader eyebrow="Клан" title="Ивент" />
      {content}
    </section>
  )
}
