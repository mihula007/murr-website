import { useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { Button } from '@/components/ui/button'
import { MessengerIcon, type Messenger } from '@/components/ui/messenger-icon'
import { toast } from '@/components/ui/toaster'
import { formErrorMessage, type AppError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useStartMaxLink, useMaxStatus, useUnlinkMax } from '@/features/max/api'
import {
  useStartTelegramLink,
  useTelegramStatus,
  useUnlinkTelegram,
} from '@/features/telegram/api'
import { useStartVkLink, useUnlinkVk, useVkStatus } from '@/features/vk/api'

/** Общее состояние привязки любого мессенджера (TGM-06, MAX-01, VK-01). */
type LinkStatus = {
  configured: boolean
  linked: boolean
  username: string | null
  displayName: string | null
  blocked: boolean
}

type MessengerHooks = {
  messenger: Messenger
  label: string
  /** Пояснение к остановленному боту (TGM-08, MAX-03, VK-03). */
  blockedHint: string
  status: UseQueryResult<LinkStatus, AppError>
  start: UseMutationResult<{ url: string }, AppError, void>
  unlink: UseMutationResult<LinkStatus, AppError, void>
}

const badgeClass =
  'absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border-2 border-card text-primary-foreground'

/**
 * Мессенджеры в кабинете (Q-105): три кнопки в ряд с логотипами, без
 * поясняющего текста. Не привязан — нажатие сразу открывает бота в новой
 * вкладке; привязан — отметка ✓ и отвязка с подтверждением; бот
 * остановлен — отметка ⚠, нажатие снова открывает бота.
 */
export function MessengerLinks() {
  const items: MessengerHooks[] = [
    {
      messenger: 'telegram',
      label: 'Telegram',
      blockedHint:
        'Бот остановлен в Telegram: нажмите, чтобы открыть бота и запустить его снова',
      status: useTelegramStatus(),
      start: useStartTelegramLink(),
      unlink: useUnlinkTelegram(),
    },
    {
      messenger: 'vk',
      label: 'ВКонтакте',
      blockedHint:
        'Сообщения от сообщества запрещены: нажмите, чтобы открыть диалог и написать сообществу',
      status: useVkStatus(),
      start: useStartVkLink(),
      unlink: useUnlinkVk(),
    },
    {
      messenger: 'max',
      label: 'MAX',
      blockedHint:
        'Бот остановлен в MAX: нажмите, чтобы открыть бота и запустить его снова',
      status: useMaxStatus(),
      start: useStartMaxLink(),
      unlink: useUnlinkMax(),
    },
  ]
  return (
    <section
      id="messengers"
      tabIndex={-1}
      aria-labelledby="messengers-title"
      className="grid gap-3 border-y border-border py-3"
    >
      <h3
        id="messengers-title"
        className="m-0 font-sans text-base font-bold text-primary"
      >
        Мессенджеры
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {items.map((item) => (
          <MessengerButton key={item.messenger} {...item} />
        ))}
      </div>
    </section>
  )
}

function MessengerButton({
  messenger,
  label,
  blockedHint,
  status,
  start,
  unlink,
}: MessengerHooks) {
  const [confirming, setConfirming] = useState(false)
  const data = status.data
  const linked = Boolean(data?.linked)
  const blocked = linked && Boolean(data?.blocked)
  const name = data?.username ? `@${data.username}` : data?.displayName

  /**
   * Одно нажатие — бот в новой вкладке (Q-105). Вкладка открывается сразу,
   * в обработчике нажатия, иначе мобильный браузер её заблокирует; адрес
   * с одноразовым кодом подставляется, когда сервер его выдаст.
   */
  async function openBot() {
    const tab = window.open('', '_blank')
    try {
      const { url } = await start.mutateAsync()
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else {
        window.location.href = url
      }
    } catch (error) {
      tab?.close()
      toast(formErrorMessage(error as AppError))
    }
  }

  let hint: string
  if (status.isPending) {
    hint = `${label}: проверяем привязку`
  } else if (status.isError) {
    hint = `${label}: ${formErrorMessage(status.error)}`
  } else if (!data?.configured) {
    hint = `${label} пока не подключён на сайте`
  } else if (blocked) {
    hint = `${label}: ${blockedHint}`
  } else if (linked) {
    hint = `${label} привязан: ${name ?? ''}. Нажмите, чтобы отвязать`
  } else {
    hint = `Привязать ${label}: откроется бот в новой вкладке`
  }
  const disabled =
    status.isPending || status.isError || !data?.configured || start.isPending

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        aria-label={hint}
        title={hint}
        className={cn(
          'relative h-auto min-w-0 px-2 py-3 max-[520px]:flex-col max-[520px]:gap-1.5',
          linked && !blocked && 'border-live-border',
          blocked && 'border-destructive',
        )}
        onClick={() => {
          if (linked && !blocked) {
            setConfirming(true)
          } else {
            void openBot()
          }
        }}
      >
        <MessengerIcon messenger={messenger} />
        <span className="min-w-0 truncate text-sm">{label}</span>
        {linked && !blocked ? (
          <span aria-hidden="true" className={cn(badgeClass, 'bg-live')}>
            <Check size={12} strokeWidth={3} />
          </span>
        ) : null}
        {blocked ? (
          <span aria-hidden="true" className={cn(badgeClass, 'bg-destructive')}>
            <AlertTriangle size={11} strokeWidth={3} />
          </span>
        ) : null}
      </Button>
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Отвязать ${label}?`}
        description={`Привязан: ${name ?? ''}. Анонсы в ${label} перестанут приходить; полученные сообщения останутся, их кнопки работать не будут.`}
        confirmLabel="Отвязать"
        pendingLabel="Отвязываем…"
        onConfirm={async () => {
          await unlink.mutateAsync()
          toast(`${label} отвязан`)
        }}
      />
    </>
  )
}
