import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SplashGate } from '@/app/splash/splash'
import {
  ACTIVITY_KEY,
  AUTO_CLOSE_MS,
  LEAVE_MS,
  readLastActivity,
  writeLastActivity,
} from '@/app/splash/splash-timing'

/** Прокрутка заблокирована утилитой Tailwind на html и body. */
const isLocked = () =>
  [document.documentElement, document.body].every((element) =>
    element.classList.contains('overflow-hidden'),
  )

function renderGate() {
  return render(
    <SplashGate>
      <p>Содержимое сайта</p>
    </SplashGate>,
  )
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn<(query: string) => MediaQueryList>(
      (query) => ({ matches, media: query }) as MediaQueryList,
    ),
  )
}

describe('SplashGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('при первом открытии показывает заставку, блокирует прокрутку и делает сайт inert', () => {
    renderGate()
    expect(screen.getByRole('dialog', { name: 'MurrClan' })).toBeVisible()
    expect(isLocked()).toBe(true)
    expect(screen.getByText('Содержимое сайта').parentElement).toHaveAttribute(
      'inert',
    )
    expect(
      screen.getByRole('button', { name: 'Пропустить анимацию' }),
    ).toHaveFocus()
  })

  it('кнопка закрывает заставку и снимает блокировку сразу', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить анимацию' }))
    expect(isLocked()).toBe(false)
    expect(
      screen.getByText('Содержимое сайта').parentElement,
    ).not.toHaveAttribute('inert')
    expect(readLastActivity()).not.toBeNull()
    act(() => vi.advanceTimersByTime(LEAVE_MS))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('закрывается по Escape', () => {
    renderGate()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(isLocked()).toBe(false)
    act(() => vi.advanceTimersByTime(LEAVE_MS))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('закрывается сама через 10 секунд', () => {
    renderGate()
    act(() => vi.advanceTimersByTime(AUTO_CLOSE_MS - 1))
    expect(isLocked()).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(isLocked()).toBe(false)
    act(() => vi.advanceTimersByTime(LEAVE_MS))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('не показывается при свежей активности', () => {
    writeLastActivity(Date.now() - 5 * 60_000)
    renderGate()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(isLocked()).toBe(false)
  })

  it('размонтирование снимает блокировку', () => {
    const view = renderGate()
    expect(isLocked()).toBe(true)
    view.unmount()
    expect(isLocked()).toBe(false)
  })

  it('с reduced motion удаляется сразу после закрытия', () => {
    stubReducedMotion(true)
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить анимацию' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('обновляет метку активности не чаще раза в 15 секунд', () => {
    writeLastActivity(Date.now() - 5 * 60_000)
    renderGate()
    fireEvent.pointerDown(window)
    const first = Number(localStorage.getItem(ACTIVITY_KEY))
    expect(first).toBe(Date.now())
    act(() => vi.advanceTimersByTime(5_000))
    fireEvent.keyDown(window, { key: 'a' })
    expect(Number(localStorage.getItem(ACTIVITY_KEY))).toBe(first)
    act(() => vi.advanceTimersByTime(15_000))
    fireEvent.keyDown(window, { key: 'a' })
    expect(Number(localStorage.getItem(ACTIVITY_KEY))).toBe(Date.now())
  })
})
