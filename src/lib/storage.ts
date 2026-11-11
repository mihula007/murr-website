/**
 * Единственный доступ к браузерным хранилищам. Хранилище может быть запрещено
 * настройками браузера или переполнено: функции не бросают исключений, а
 * пробуют области по порядку.
 */
export type StorageArea = 'local' | 'session'

const AREA_NAMES = {
  local: 'localStorage',
  session: 'sessionStorage',
} as const

function* available(areas: readonly StorageArea[]) {
  for (const area of areas) {
    let storage: Storage | undefined
    try {
      storage = window[AREA_NAMES[area]]
    } catch {
      // Хранилище запрещено настройками браузера.
    }
    if (storage) yield storage
  }
}

/** Первое найденное значение по порядку областей или `null`. */
export function readStored(key: string, areas: readonly StorageArea[]) {
  for (const storage of available(areas)) {
    try {
      const value = storage.getItem(key)
      if (value !== null) return value
    } catch {
      // Пробуем следующую область.
    }
  }
  return null
}

/** Записывает в первую доступную область; `false`, если не удалось нигде. */
export function writeStored(
  key: string,
  value: string,
  areas: readonly StorageArea[],
) {
  for (const storage of available(areas)) {
    try {
      storage.setItem(key, value)
      return true
    } catch {
      // Пробуем следующую область.
    }
  }
  return false
}

/** Удаляет значение из всех перечисленных областей. */
export function removeStored(key: string, areas: readonly StorageArea[]) {
  for (const storage of available(areas)) {
    try {
      storage.removeItem(key)
    } catch {
      // Нечего удалять.
    }
  }
}
