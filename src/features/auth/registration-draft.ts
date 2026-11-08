import type { RegistrationFields } from '@contracts/account'

/** Черновик анкеты во вкладке до подтверждения email (Q-28). Без пароля. */
export type RegistrationDraft = Partial<RegistrationFields> & { email?: string }

const DRAFT_KEY = 'murr-registration-draft'
let pendingAvatar: Blob | null = null

export function saveDraft(draft: RegistrationDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Хранилище недоступно: при прерывании поля придётся ввести заново.
  }
}

export function loadDraft(): RegistrationDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as RegistrationDraft) : null
  } catch {
    return null
  }
}

export function clearDraft() {
  pendingAvatar = null
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Нечего очищать.
  }
}

/** Аватар живёт только в памяти вкладки и теряется при перезагрузке. */
export function setPendingAvatar(avatar: Blob | null) {
  pendingAvatar = avatar
}

export function getPendingAvatar() {
  return pendingAvatar
}
