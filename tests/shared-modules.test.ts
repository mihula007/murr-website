import { AuthError, FunctionsFetchError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIMITS } from '@contracts/account'
import { avatarInitial } from '@/components/ui/avatar'
import {
  AppError,
  errorMessage,
  fieldMessage,
  formErrorMessage,
} from '@/lib/errors'
import { formatDate } from '@/lib/format-date'
import { readStored, removeStored, writeStored } from '@/lib/storage'
import { toAppError } from '@/lib/supabase/errors'

describe('toAppError', () => {
  it('сохраняет AppError', () => {
    const error = new AppError('forbidden')
    expect(toAppError(error)).toBe(error)
  })

  it('переводит известный код Auth', () => {
    const error = new AuthError('bad', 400, 'invalid_credentials')
    expect(toAppError(error).code).toBe('invalid_credentials')
  })

  it('считает Auth без ответа сервера отсутствием связи', () => {
    expect(toAppError(new AuthError('offline', 0)).code).toBe('network')
  })

  it('считает сбой запроса к функции отсутствием связи', () => {
    expect(toAppError(new FunctionsFetchError({})).code).toBe('network')
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('network')
  })

  it('прочее — unknown', () => {
    expect(toAppError(new AuthError('x', 500, 'unexpected')).code).toBe(
      'unknown',
    )
    expect(toAppError('boom').code).toBe('unknown')
  })
})

describe('каталог сообщений', () => {
  it('один текст «нет связи»', () => {
    expect(errorMessage('network')).toBe(
      'Нет связи с сервером. Проверьте интернет и повторите.',
    )
  })

  it('длина пароля берётся из LIMITS', () => {
    expect(fieldMessage('password_short')).toContain(String(LIMITS.passwordMin))
    expect(errorMessage('weak_password')).toContain(String(LIMITS.passwordMin))
  })

  it('поле может показать код Auth или сервера', () => {
    expect(fieldMessage('otp_expired')).toBe(errorMessage('otp_expired'))
    expect(fieldMessage('nickname_taken')).toBe('Этот ник уже занят')
    expect(fieldMessage('no_such_code')).toBe('Проверьте значение')
  })

  it('ошибки полей не дублируются в блоке формы', () => {
    expect(formErrorMessage(null)).toBeNull()
    expect(
      formErrorMessage(new AppError('otp_expired', { code: 'otp_expired' })),
    ).toBeNull()
    expect(
      formErrorMessage(new AppError('validation_failed', { city: 'too_long' })),
    ).toBe('Проверьте поля формы.')
    expect(formErrorMessage(new AppError('network'))).toBe(
      errorMessage('network'),
    )
  })
})

describe('безопасное хранилище', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('пишет в первую доступную область и читает по порядку', () => {
    expect(writeStored('k', 'v', ['local', 'session'])).toBe(true)
    expect(localStorage.getItem('k')).toBe('v')
    expect(readStored('k', ['session', 'local'])).toBe('v')
    removeStored('k', ['local', 'session'])
    expect(readStored('k', ['local', 'session'])).toBeNull()
  })

  it('не бросает исключений при запрещённом хранилище', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(writeStored('k', 'v', ['local', 'session'])).toBe(false)
    expect(readStored('k', ['local', 'session'])).toBeNull()
    expect(() => removeStored('k', ['local'])).not.toThrow()
  })
})

describe('общие форматы', () => {
  it('дата ДД.ММ.ГГГГ без перевода часового пояса', () => {
    expect(formatDate('1995-04-12')).toBe('12.04.1995')
    expect(formatDate('2026-11-08T23:30:00Z')).toBe('08.11.2026')
    expect(formatDate(null)).toBe('—')
  })

  it('первая буква аватара', () => {
    expect(avatarInitial(' мурка')).toBe('М')
    expect(avatarInitial('')).toBe('?')
  })
})
