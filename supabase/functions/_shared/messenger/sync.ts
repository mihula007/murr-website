import type { AppDeps } from '../app.ts'
import { syncMaxEventMessage } from '../max/announcements.ts'
import { syncEventMessage } from '../telegram/announcements.ts'
import { syncVkEventMessage } from '../vk/announcements.ts'

export type Messenger = 'telegram' | 'max' | 'vk'

/**
 * Ответ на событие → активные сообщения анонса во всех мессенджерах
 * (TGM-21, MAX-08, VK-07). `skip` — мессенджер, где сообщение уже перерисовано
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
    ['vk', () => syncVkEventMessage(deps, userId, eventId)],
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

type VoteSyncModule = {
  syncVoteMessage?: (
    deps: AppDeps,
    userId: string,
    voteId: string,
  ) => Promise<void>
}

/**
 * Сайт и мессенджер приводят активные кнопки участника к одному выбору.
 * Загрузчик канала вызывается только при включённой интеграции, чтобы локальные
 * окружения без подключённых ботов продолжали обслуживать голоса на сайте.
 */
export async function syncVoteMessages(
  deps: AppDeps,
  userId: string,
  voteId: string,
  skip?: Messenger,
) {
  const tasks: [Messenger, () => Promise<unknown>][] = []
  if (deps.telegram) {
    tasks.push([
      'telegram',
      async () =>
        (await import('../telegram/announcements.ts')) as VoteSyncModule,
    ])
  }
  if (deps.max) {
    tasks.push([
      'max',
      async () => (await import('../max/announcements.ts')) as VoteSyncModule,
    ])
  }
  if (deps.vk) {
    tasks.push([
      'vk',
      async () => (await import('../vk/announcements.ts')) as VoteSyncModule,
    ])
  }

  await Promise.all(
    tasks
      .filter(([name]) => name !== skip)
      .map(([name, load]) =>
        load()
          .then((module) => {
            const voteModule = module as VoteSyncModule
            if (!voteModule.syncVoteMessage) {
              throw new Error(`В ${name} пока нет обновления голосования`)
            }
            return voteModule.syncVoteMessage(deps, userId, voteId)
          })
          .catch((error: unknown) => {
            console.error(`Сообщение голосования ${name} не обновлено`, error)
          }),
      ),
  )
}
