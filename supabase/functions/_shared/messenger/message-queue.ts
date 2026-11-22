const updates = new Map<string, Promise<void>>()

/** Упорядочивает правки одного сообщения и запускает каждую на свежих данных. */
export function serializeMessageUpdate(
  key: string,
  update: () => Promise<void>,
): Promise<void> {
  const previous = updates.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(update)
  updates.set(key, current)
  return current.finally(() => {
    if (updates.get(key) === current) {
      updates.delete(key)
    }
  })
}
