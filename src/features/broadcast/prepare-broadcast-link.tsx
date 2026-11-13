import { Link } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import type { BroadcastSource } from '@contracts/broadcasts'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * «Подготовить рассылку» из события, голосования или группы (EVT-15,
 * VOT-14, GRP-11): открывает форму, заполненную сервером.
 */
export function PrepareBroadcastLink({
  source,
  id,
  className,
}: {
  source: BroadcastSource
  id: string
  className?: string
}) {
  return (
    <Link
      to="/broadcast"
      search={{ source, id }}
      className={cn(
        buttonVariants({ variant: 'secondary', size: 'sm' }),
        'no-underline',
        className,
      )}
    >
      <Send size={14} aria-hidden="true" /> Подготовить рассылку
    </Link>
  )
}
