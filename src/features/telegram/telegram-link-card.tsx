import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { TelegramLinkStart, TelegramStatus } from '@contracts/telegram'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { FormError } from '@/components/form/form-error'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { formErrorMessage } from '@/lib/errors'
import {
  useStartTelegramLink,
  useTelegramStatus,
  useUnlinkTelegram,
} from './api'

const blockClass = 'grid gap-3 border-y border-border py-3'
const titleClass = 'm-0 font-sans text-base font-bold text-primary'
const hintClass = 'm-0 text-sm text-muted-foreground'

/**
 * Блок «Telegram» в кабинете члена, офицера и администратора (TGM-01–TGM-08):
 * привязка через бота, состояние, отвязка.
 */
export function TelegramLinkCard() {
  const status = useTelegramStatus()
  let content
  if (status.isPending) {
    content = <p className={hintClass}>Проверяем привязку…</p>
  } else if (status.isError) {
    content = (
      <div className="grid gap-2">
        <FormError message={formErrorMessage(status.error)} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="justify-self-start"
          onClick={() => void status.refetch()}
        >
          Повторить
        </Button>
      </div>
    )
  } else if (!status.data.configured) {
    content = (
      <p className={hintClass}>
        Telegram пока не подключён на сайте: привязка появится, когда
        администратор настроит бота.
      </p>
    )
  } else if (status.data.linked) {
    content = <Linked status={status.data} />
  } else {
    content = <NotLinked />
  }
  return (
    <section aria-labelledby="telegram-title" className={blockClass}>
      <h3 id="telegram-title" className={titleClass}>
        Telegram
      </h3>
      {content}
    </section>
  )
}

function NotLinked() {
  const start = useStartTelegramLink()
  const [link, setLink] = useState<TelegramLinkStart | null>(null)
  const request = () =>
    start.mutate(undefined, { onSuccess: (data) => setLink(data) })

  if (link) {
    return (
      <div className="grid gap-3">
        <p className={hintClass}>
          Откройте бота и нажмите «Запустить» (Start). Ссылка одноразовая и
          действует 15 минут. Затем вернитесь на эту страницу.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {/* Обычная ссылка, а не window.open после запроса: мобильный браузер не заблокирует её. */}
          <Button asChild>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              Открыть бота <ExternalLink size={16} aria-hidden="true" />
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={start.isPending}
            onClick={request}
          >
            Получить новую ссылку
          </Button>
        </div>
        <FormError
          message={start.error ? formErrorMessage(start.error) : null}
        />
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      <p className={hintClass}>
        Анонсы клана приходят в чат с ботом. На анонс события можно ответить
        кнопками «Приду», «50/50» или «Не приду».
      </p>
      <Button
        type="button"
        variant="secondary"
        className="justify-self-start"
        disabled={start.isPending}
        onClick={request}
      >
        {start.isPending ? 'Готовим ссылку…' : 'Привязать Telegram'}
      </Button>
      <FormError message={start.error ? formErrorMessage(start.error) : null} />
    </div>
  )
}

function Linked({ status }: { status: TelegramStatus }) {
  const unlink = useUnlinkTelegram()
  const [confirming, setConfirming] = useState(false)
  const name = status.username ? `@${status.username}` : status.displayName
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm break-words">
        Привязан: <strong>{name}</strong>
      </p>
      {status.blocked ? (
        <Notice className="text-sm">
          Бот остановлен в Telegram, анонсы не приходят. Откройте бота и нажмите
          «Запустить», чтобы получать их снова.
        </Notice>
      ) : (
        <p className={hintClass}>Анонсы клана приходят в чат с ботом.</p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="justify-self-start"
        onClick={() => setConfirming(true)}
      >
        Отвязать
      </Button>
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Отвязать Telegram?"
        description="Анонсы перестанут приходить. Уже полученные сообщения останутся в Telegram, их кнопки работать не будут."
        confirmLabel="Отвязать"
        pendingLabel="Отвязываем…"
        onConfirm={async () => {
          await unlink.mutateAsync()
          toast('Telegram отвязан')
        }}
      />
    </div>
  )
}
