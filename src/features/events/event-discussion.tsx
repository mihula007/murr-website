import { MessagesSquare } from 'lucide-react'
import type { ThreadRef } from '@contracts/discussions'
import { Card } from '@/components/ui/surfaces'
import { useMediaQuery } from '@/components/virtual-list'
import { DiscussionDialog } from '@/features/discussions/discussion-dialog'
import { DiscussionThread } from '@/features/discussions/discussion-thread'

type EventDiscussionProps = {
  thread: ThreadRef
  title: string
  messageCount: number | undefined
}

/** Чат события встроен на широком экране и открывается кнопкой на телефоне. */
export function EventDiscussion({
  thread,
  title,
  messageCount,
}: EventDiscussionProps) {
  const wideScreen = useMediaQuery('(min-width: 64rem)')

  if (!wideScreen) {
    return (
      <DiscussionDialog
        thread={thread}
        title={title}
        messageCount={messageCount}
        triggerLabel="Обсуждение ивента"
        className="w-full"
      />
    )
  }

  return (
    <Card className="flex h-[340px] min-h-0 flex-col gap-3 p-4">
      <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
        <MessagesSquare size={18} aria-hidden="true" />
        Обсуждение ивента ({messageCount ?? 0})
      </h2>
      <DiscussionThread
        thread={thread}
        className="min-h-0 flex-1"
        listClassName="min-h-0 flex-1"
      />
    </Card>
  )
}
