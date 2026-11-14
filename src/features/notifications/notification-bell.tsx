import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bell, CheckCheck } from 'lucide-react'
import type { NotificationItem } from '@contracts/notifications'
import { useAccess, type AccessRole } from '@/app/access'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button } from '@/components/ui/button'
import { NavBadge } from '@/components/ui/nav-badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from '@/components/ui/toaster'
import { errorMessage, type AppError } from '@/lib/errors'
import { formatDateTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import {
  useNotificationList,
  useReadAllNotifications,
  useReadNotification,
} from './api'
import { notificationRoute } from './notification-target'

/** Кто видит колокольчик (NTF-01, HOM-01, HOM-10): не гость и не чтец. */
export function canSeeNotifications(role: AccessRole) {
  return (
    role === 'applicant' ||
    role === 'member' ||
    role === 'officer' ||
    role === 'admin'
  )
}

const showError = (error: unknown) =>
  toast(errorMessage((error as AppError).code ?? 'unknown'))

type NotificationRowProps = {
  item: NotificationItem
  onOpen: (item: NotificationItem) => void
}

function NotificationRow({ item, onOpen }: NotificationRowProps) {
  const unread = item.readAt === null
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          'flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left text-foreground outline-none hover:bg-secondary focus-visible:inset-ring focus-visible:inset-ring-border-accent',
          unread && 'bg-secondary/60',
        )}
      >
        <span className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'mt-1.5 size-2 flex-none rounded-full',
              unread ? 'bg-badge' : 'bg-transparent',
            )}
          />
          <span
            className={cn(
              'min-w-0 text-sm',
              unread ? 'font-bold' : 'font-medium',
            )}
          >
            {item.title}
            {unread && <span className="sr-only"> (не прочитано)</span>}
          </span>
        </span>
        {item.body && (
          <span className="line-clamp-2 pl-4 text-[13px] break-words text-muted-foreground">
            {item.body}
          </span>
        )}
        <time
          dateTime={item.createdAt}
          className="pl-4 text-2xs text-muted-foreground"
        >
          {formatDateTimeMsk(item.createdAt)}
        </time>
      </button>
    </li>
  )
}

type NotificationPanelProps = {
  role: AccessRole
  onClose: () => void
}

/** Личная история: открытие панели ничего не отмечает прочитанным (NTF-05). */
function NotificationPanel({ role, onClose }: NotificationPanelProps) {
  const navigate = useNavigate()
  const list = useNotificationList(true)
  const read = useReadNotification()
  const readAll = useReadAllNotifications()

  const open = (item: NotificationItem) => {
    if (item.readAt === null) {
      read.mutate(item.id, { onError: showError })
    }
    const route = notificationRoute(item.target, role)
    if (route) {
      onClose()
      void navigate(route)
    }
  }

  const unreadCount = list.data?.unreadCount ?? 0
  return (
    <>
      <div className="flex min-h-[53px] items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="m-0 font-sans text-base font-bold">Уведомления</h2>
        {/* Читать нечего — кнопки нет: пустая панель без лишнего действия. */}
        {unreadCount > 0 ? (
          <Button
            variant="ghost"
            className="h-auto gap-1.5 px-2 py-1 text-[13px]"
            disabled={readAll.isPending}
            onClick={() => readAll.mutate(undefined, { onError: showError })}
          >
            <CheckCheck aria-hidden="true" size={16} />
            Прочитать все
          </Button>
        ) : null}
      </div>
      <div className="max-h-[min(70svh,520px)] overflow-y-auto p-1.5">
        {list.isPending ? (
          <LoadingState
            label="Загрузка уведомлений…"
            rows={3}
            className="p-2"
          />
        ) : list.isError ? (
          <ErrorState
            className="border-0 bg-transparent px-3 py-6"
            message="Не удалось загрузить уведомления."
            onRetry={() => void list.refetch()}
          />
        ) : list.data.items.length === 0 ? (
          <p className="m-0 px-3 py-8 text-center text-sm text-muted-foreground">
            Уведомлений пока нет.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {list.data.items.map((item) => (
              <NotificationRow key={item.id} item={item} onOpen={open} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

type NotificationBellProps = { unreadCount: number | undefined }

/** Колокольчик в шапке со значком непрочитанных (NTF-02: свыше 99 — «99+»). */
export function NotificationBell({ unreadCount }: NotificationBellProps) {
  const { role } = useAccess()
  const [open, setOpen] = useState(false)
  const count = unreadCount ?? 0
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="relative size-[38px]"
          aria-label={
            count > 0
              ? `Уведомления, непрочитанных: ${count > 99 ? 'больше 99' : count}`
              : 'Уведомления'
          }
        >
          <Bell aria-hidden="true" size={18} />
          <NavBadge
            count={count}
            className="pointer-events-none absolute -top-1.5 -right-1.5"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Уведомления">
        {open && (
          <NotificationPanel role={role} onClose={() => setOpen(false)} />
        )}
      </PopoverContent>
    </Popover>
  )
}
