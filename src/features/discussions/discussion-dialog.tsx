import { useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import type { ThreadRef } from '@contracts/discussions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DiscussionThread } from './discussion-thread'

type DiscussionDialogProps = {
  thread: ThreadRef
  /** Заголовок родителя в шапке окна. */
  title: string
  messageCount: number | undefined
  className?: string
}

/**
 * Кнопка «Обсуждение (N)» и окно ветки голосования, публикации или
 * объявления (DSC-01, DSC-15): закрывается кнопкой, Escape и кликом вне,
 * фокус возвращается на кнопку. Ветка грузится и опрашивается, только пока
 * окно открыто (Q-58).
 */
export function DiscussionDialog({
  thread,
  title,
  messageCount,
  className,
}: DiscussionDialogProps) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className={className}>
          <MessagesSquare size={18} aria-hidden="true" />
          Обсуждение ({messageCount ?? 0})
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(calc(100svh-28px),760px)] w-[min(calc(100vw-28px),720px)] flex-col gap-3 overflow-hidden max-xs:h-svh max-xs:w-screen max-xs:max-h-svh max-xs:rounded-none">
        <DialogHeader>
          <DialogTitle>Обсуждение</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>
        {open ? (
          <DiscussionThread
            thread={thread}
            className="min-h-0 flex-1"
            listClassName="min-h-0 flex-1"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
