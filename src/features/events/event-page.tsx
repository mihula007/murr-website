import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import {
  EVENT_ANSWER_LABELS,
  EVENT_ANSWERS,
  type EventAnswer,
  type EventDetails,
  type EventParticipant,
} from '@contracts/events'
import { SMALL_LIST_LIMIT } from '@contracts/paging'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { PageHeader } from '@/components/states/page-header'
import { Avatar } from '@/components/ui/avatar'
import { linkButtonClass } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useEvent } from './api'
import { EventCard } from './event-card'

const sectionTitleClass =
  'm-0 text-xs font-extrabold tracking-[0.16em] text-primary uppercase'

type ParticipantTab = EventAnswer | 'none'
const PARTICIPANT_TABS: { value: ParticipantTab; label: string }[] = [
  ...EVENT_ANSWERS.map((answer) => ({
    value: answer,
    label: EVENT_ANSWER_LABELS[answer],
  })),
  { value: 'none', label: 'Без ответа' },
]

const matches = (person: EventParticipant, tab: ParticipantTab) =>
  tab === 'none' ? person.answer === null : person.answer === tab

/**
 * Участники по ответам (EVT-06): текущий состав и ответившие. Только чтение
 * — группы появятся на этапе 7.
 */
function Participants({ event }: { event: EventDetails }) {
  const [tab, setTab] = useState<ParticipantTab>('yes')
  const people = event.participants.filter((person) => matches(person, tab))
  const label = PARTICIPANT_TABS.find((item) => item.value === tab)!.label

  return (
    <Card className="grid gap-3">
      <h2 className={sectionTitleClass}>Участники</h2>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ParticipantTab)}
      >
        <TabsList
          aria-label="Ответы участников"
          className="flex-wrap max-xs:grid max-xs:grid-cols-2"
        >
          {PARTICIPANT_TABS.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="inline-flex items-center gap-1.5"
            >
              {item.label}
              <span className="text-xs text-muted-foreground tabular-nums">
                {
                  event.participants.filter((person) =>
                    matches(person, item.value),
                  ).length
                }
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {people.length === 0 ? (
        <p className="m-0 text-muted-foreground">Никого нет.</p>
      ) : (
        <ul aria-label={label} className="m-0 grid list-none gap-0 p-0">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex min-w-0 items-center gap-3 border-b border-border py-2 last:border-b-0"
            >
              <Avatar
                name={person.gameNickname}
                src={person.avatarUrl}
                alt=""
              />
              <span className="grid min-w-0">
                <strong className="break-words">{person.gameNickname}</strong>
                <span className="text-xs text-muted-foreground">
                  {person.className}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {event.participantsTruncated ? (
        <output className="text-sm text-muted-foreground">
          Показаны первые {SMALL_LIST_LIMIT} участников: сначала ответившие, по
          нику. Счётчики в карточке учитывают все ответы.
        </output>
      ) : null}
    </Card>
  )
}

/** Страница события: карточка, описание и участники (EVT-06). */
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
      <div className="mx-auto grid w-full max-w-[720px] gap-4">
        <EventCard
          event={data}
          onDeleted={() =>
            void navigate({ to: '/events', search: { tab: 'active' } })
          }
        />
        <Participants event={data} />
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
