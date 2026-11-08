import type { ClientErrorCode } from './client'

const ERROR_MESSAGES: Record<ClientErrorCode, string> = {
  not_authenticated: 'Сессия завершилась. Войдите снова.',
  email_not_confirmed: 'Подтвердите email кодом из письма.',
  forbidden: 'Недостаточно прав для этого действия.',
  not_found: 'Не найдено.',
  registration_incomplete: 'Сначала завершите регистрацию.',
  already_bootstrapped: 'Администратор уже назначен.',
  validation_failed: 'Проверьте поля формы.',
  avatar_invalid:
    'Аватар не принят: нужен JPEG, PNG или WebP до 500 КБ. Выберите файл ещё раз.',
  internal: 'Сервер не смог выполнить действие. Попробуйте ещё раз позже.',
  network: 'Нет связи с сервером. Проверьте интернет и повторите.',
  unavailable: 'Вход временно недоступен: сервер не подключён.',
}

const FIELD_MESSAGES: Record<string, string> = {
  required: 'Заполните поле',
  too_long: 'Слишком длинное значение',
  too_many: 'Слишком много значений',
  invalid_date: 'Укажите корректную дату',
  invalid_url: 'Нужна ссылка, начинающаяся с http:// или https://',
  nickname_taken: 'Этот ник уже занят',
  profile_exists: 'Профиль уже существует',
  avatar_invalid: 'Нужен JPEG, PNG или WebP до 500 КБ',
}

export function errorMessage(code: ClientErrorCode) {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal
}

export function fieldMessage(code: string) {
  return FIELD_MESSAGES[code] ?? 'Проверьте значение'
}
