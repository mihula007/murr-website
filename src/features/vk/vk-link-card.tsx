import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { VkLinkStart, VkStatus } from '@contracts/vk'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { FormError } from '@/components/form/form-error'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { formErrorMessage } from '@/lib/errors'
import { useVkStatus, useStartVkLink, useUnlinkVk } from './api'

const blockClass = 'grid gap-3 border-y border-border py-3'
const titleClass = 'm-0 font-sans text-base font-bold text-primary'
const hintClass = 'm-0 text-sm text-muted-foreground'

/**
 * Блок «ВКонтакте» в кабинете члена, офицера и администратора (VK-01–VK-03):
 * привязка через сообщество, состояние, отвязка. Повторяет блок Telegram.
 */
export function VkLinkCard() {
  const status = useVkStatus()
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
        ВКонтакте пока не подключён на сайте: привязка появится, когда
        администратор настроит бота сообщества.
      </p>
    )
  } else if (status.data.linked) {
    content = <Linked status={status.data} />
  } else {
    content = <NotLinked />
  }
  return (
    <section aria-labelledby="vk-title" className={blockClass}>
      <h3 id="vk-title" className={titleClass}>
        ВКонтакте
      </h3>
      {content}
    </section>
  )
}

function NotLinked() {
  const start = useStartVkLink()
  const [link, setLink] = useState<VkLinkStart | null>(null)
  const request = () =>
    start.mutate(undefined, { onSuccess: (data) => setLink(data) })

  if (link) {
    return (
      <div className="grid gap-3">
        <p className={hintClass}>
          Откройте диалог с сообществом и отправьте любое сообщение (или нажмите
          «Начать»). Ссылка одноразовая и действует 15 минут. Затем вернитесь на
          эту страницу.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {/* Обычная ссылка, а не window.open после запроса: мобильный браузер не заблокирует её. */}
          <Button asChild>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              Открыть диалог <ExternalLink size={16} aria-hidden="true" />
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
        Анонсы клана могут приходить и во ВКонтакте. На анонс события можно
        ответить кнопками «Приду», «50/50» или «Не приду».
      </p>
      <Button
        type="button"
        variant="secondary"
        className="justify-self-start"
        disabled={start.isPending}
        onClick={request}
      >
        {start.isPending ? 'Готовим ссылку…' : 'Привязать ВКонтакте'}
      </Button>
      <FormError message={start.error ? formErrorMessage(start.error) : null} />
    </div>
  )
}

function Linked({ status }: { status: VkStatus }) {
  const unlink = useUnlinkVk()
  const [confirming, setConfirming] = useState(false)
  const name = status.username ? `@${status.username}` : status.displayName
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm break-words">
        Привязан: <strong>{name}</strong>
      </p>
      {status.blocked ? (
        <Notice className="text-sm">
          Сообщения от сообщества запрещены во ВКонтакте, анонсы не приходят.
          Разрешите сообщения или напишите сообществу, чтобы получать их снова.
        </Notice>
      ) : (
        <p className={hintClass}>
          Анонсы клана приходят в диалог с сообществом.
        </p>
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
        title="Отвязать ВКонтакте?"
        description="Анонсы во ВКонтакте перестанут приходить. Уже полученные сообщения останутся, их кнопки работать не будут."
        confirmLabel="Отвязать"
        pendingLabel="Отвязываем…"
        onConfirm={async () => {
          await unlink.mutateAsync()
          toast('ВКонтакте отвязан')
        }}
      />
    </div>
  )
}
