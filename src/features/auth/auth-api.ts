import type { Session } from '@supabase/supabase-js'
import { AppError } from '@/lib/errors'
import { getSupabaseClient, requireSupabase } from '@/lib/supabase/client'
import { toAppError } from '@/lib/supabase/errors'

/**
 * Все операции Supabase Auth приложения. Страницы и компоненты вызывают
 * только эти функции (через `useMutation`) и не импортируют клиент Supabase.
 * Любая ошибка приходит как `AppError`; ошибки, относящиеся к полю формы,
 * несут его в `fields` (поле → код сообщения).
 */
export type AuthSession = Session
export type Credentials = { email: string; password: string }

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toAppError(error)
  }
}

/** Ошибка проверки кода из письма — у поля `code`. */
function codeError(error: unknown) {
  const { code } = toAppError(error)
  return new AppError(code, { code })
}

/** Auth настроен: в сборке есть публичная конфигурация Supabase. */
export function isAuthConfigured() {
  return getSupabaseClient() !== null
}

/**
 * Подписка на сессию: сразу сообщает текущую, затем каждое изменение.
 * Без конфигурации Supabase возвращает `null`.
 */
export function subscribeToSession(
  listener: (session: AuthSession | null) => void,
) {
  const supabase = getSupabaseClient()
  if (!supabase) return null
  void supabase.auth.getSession().then(({ data }) => listener(data.session))
  const { data } = supabase.auth.onAuthStateChange((_event, session) =>
    listener(session),
  )
  return () => data.subscription.unsubscribe()
}

/** Вход по email и паролю; возвращает id пользователя. */
export function signIn(credentials: Credentials) {
  return run(async () => {
    const { data, error } =
      await requireSupabase().auth.signInWithPassword(credentials)
    if (error) throw error
    return data.user.id
  })
}

/**
 * Создание аккаунта Auth с письмом-кодом. Подтверждённый адрес Auth отмечает
 * ошибкой или пользователем без identities — тогда `exists`.
 */
export function signUp(credentials: Credentials) {
  return run(async (): Promise<'created' | 'exists'> => {
    const { data, error } = await requireSupabase().auth.signUp(credentials)
    if (error?.code === 'user_already_exists') return 'exists'
    if (error) throw error
    return data.user?.identities?.length === 0 ? 'exists' : 'created'
  })
}

/** Подтверждение email кодом из письма; возвращает id пользователя. */
export async function verifySignupCode({
  email,
  code,
}: {
  email: string
  code: string
}) {
  const result = await run(() =>
    requireSupabase().auth.verifyOtp({ email, token: code, type: 'signup' }),
  ).catch((error: unknown) => {
    throw codeError(error)
  })
  if (result.error || !result.data.user) throw codeError(result.error)
  return result.data.user.id
}

/** Повторная отправка кода подтверждения email. */
export function resendSignupCode(email: string) {
  return run(async () => {
    const { error } = await requireSupabase().auth.resend({
      type: 'signup',
      email,
    })
    if (error) throw error
  })
}

/** Письмо с кодом для смены пароля (без redirect-ссылки). */
export function sendPasswordResetCode(email: string) {
  return run(async () => {
    const { error } = await requireSupabase().auth.resetPasswordForEmail(email)
    if (error) throw error
  })
}

/** Смена пароля по коду из письма. Неверный код — ошибка поля `code`. */
export async function resetPassword({
  email,
  code,
  password,
}: {
  email: string
  code: string
  password: string
}) {
  const verified = await run(() =>
    requireSupabase().auth.verifyOtp({ email, token: code, type: 'recovery' }),
  ).catch((error: unknown) => {
    throw codeError(error)
  })
  if (verified.error) throw codeError(verified.error)
  await updatePassword(password)
}

/**
 * Смена своего пароля. Текущий пароль проверяется повторным входом той же
 * учётной записи; неверный — ошибка поля `currentPassword`.
 */
export async function changePassword({
  email,
  currentPassword,
  newPassword,
}: {
  email: string
  currentPassword: string
  newPassword: string
}) {
  const check = await run(() =>
    requireSupabase().auth.signInWithPassword({
      email,
      password: currentPassword,
    }),
  )
  if (check.error) {
    throw new AppError('current_password_wrong', {
      currentPassword: 'current_password_wrong',
    })
  }
  await updatePassword(newPassword)
}

function updatePassword(password: string) {
  return run(async () => {
    const { error } = await requireSupabase().auth.updateUser({ password })
    if (error) throw error
  })
}

/** Выход из аккаунта. */
export function signOut() {
  return run(async () => {
    const { error } = await requireSupabase().auth.signOut()
    if (error) throw error
  })
}
