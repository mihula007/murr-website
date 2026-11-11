import type { RegistrationFields } from '@contracts/account'
import { readStored, removeStored, writeStored } from '@/lib/storage'

/** Черновик анкеты во вкладке до подтверждения email (Q-28). Без пароля. */
export type RegistrationDraft = Partial<RegistrationFields> & { email?: string }

const DRAFT_KEY = 'murr-registration-draft'
/** Черновик живёт только во вкладке. */
const AREAS = ['session'] as const
let pendingAvatar: Blob | null = null

/** При недоступном хранилище поля после прерывания придётся ввести заново. */
export function saveDraft(draft: RegistrationDraft) {
  writeStored(DRAFT_KEY, JSON.stringify(draft), AREAS)
}

export function loadDraft(): RegistrationDraft | null {
  const raw = readStored(DRAFT_KEY, AREAS)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as RegistrationDraft
  } catch {
    return null
  }
}

export function clearDraft() {
  pendingAvatar = null
  removeStored(DRAFT_KEY, AREAS)
}

/** Аватар живёт только в памяти вкладки и теряется при перезагрузке. */
export function setPendingAvatar(avatar: Blob | null) {
  pendingAvatar = avatar
}

export function getPendingAvatar() {
  return pendingAvatar
}
