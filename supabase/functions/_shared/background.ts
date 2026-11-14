import type { AppDeps } from './app.ts'

/**
 * Задача после основного действия, сбой которой не должен его отменять
 * (TGM-21). В функции — после ответа (`deps.background`), в тестах — сразу;
 * ошибка только логируется.
 */
export async function runInBackground(
  deps: Pick<AppDeps, 'background'>,
  task: () => Promise<void>,
) {
  const safe = () =>
    task().catch((error: unknown) => {
      console.error('Фоновая задача не выполнена', error)
    })
  await (deps.background ? deps.background(safe) : safe())
}
