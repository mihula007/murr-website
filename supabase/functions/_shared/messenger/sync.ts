import type { AppDeps } from '../app.ts'
import { syncMaxEventMessage } from '../max/announcements.ts'
import { syncEventMessage } from '../telegram/announcements.ts'

export type Messenger = 'telegram' | 'max'

/**
 * Ответ на событие → активные сообщения анонса во всех мессенджерах
 * (TGM-21, MAX-08). `skip` — мессенджер, где сообщение уже перерисовано
 * нажатием. Сбой одного мессенджера не мешает другому и только логируется.
 */
export async function syncEventMessages(
  deps: AppDeps,
  userId: string,
  eventId: string,
  skip?: Messenger,
) {
  const tasks: [Messenger, () => Promise<unknown>][] = [
    ['telegram', () => syncEventMessage(deps, userId, eventId)],
    ['max', () => syncMaxEventMessage(deps, userId, eventId)],
  ]
  await Promise.all(
    tasks
      .filter(([name]) => name !== skip)
      .map(([name, task]) =>
        task().catch((error: unknown) => {
          console.error(`Сообщение ${name} не обновлено`, error)
        }),
      ),
  )
}
