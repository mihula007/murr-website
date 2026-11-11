import type { MeResponse, RegistrationFields } from '@contracts/account'
import { uploadAvatar } from '@/features/account/upload-avatar'
import { callApi } from '@/lib/supabase/api'
import { clearDraft } from './registration-draft'

/**
 * Шаги 5–6 регистрации: аватар, затем одна идемпотентная операция сервера.
 * Повтор после сбоя безопасен. Черновик очищается только после успеха.
 */
export async function finishRegistration(
  fields: RegistrationFields,
  avatar: Blob,
) {
  const avatarPath = await uploadAvatar(avatar)
  const me = await callApi<MeResponse>('account/complete-registration', {
    ...fields,
    avatarPath,
  })
  if (me.state === 'ready') clearDraft()
  return me
}
