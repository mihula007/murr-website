import type { PropsWithChildren } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Header } from './header'

/** Страницы с иллюстрацией в полную силу: главная, вход и регистрация. */
const SHOWCASE_PATHS = ['/', '/login', '/register', '/reset-password']

const isShowcase = (pathname: string) =>
  SHOWCASE_PATHS.includes(pathname) || pathname.startsWith('/register/')

export function AppShell({ children }: PropsWithChildren) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const showcase = isShowcase(pathname)
  return (
    <div className="relative isolate flex min-h-svh flex-col">
      {/* Фон под шапкой: высота картинки — 55vw (110% ширины, пропорции 2:1),
          низ плавно уходит в цвет страницы, без резкой границы. На рабочих
          страницах — приглушённая полоса: иллюстрация не спорит с текстом. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 -z-10 bg-(image:--image-site) bg-size-[110%_auto] bg-position-[calc(50%-2vw)_95px] bg-no-repeat',
          showcase
            ? 'h-[calc(95px+55vw)] mask-b-from-70%'
            : 'h-[calc(95px+min(26vw,320px))] opacity-35 mask-b-from-0%',
        )}
      />
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
        className="sr-only rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Перейти к содержимому
      </a>
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1240px] min-w-0 flex-1 px-[22px] py-14 outline-none max-sm:px-[14px] max-sm:py-9"
      >
        {children}
      </main>
      <footer className="border-t border-border py-[25px] text-xs text-muted-foreground">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap justify-between gap-x-6 gap-y-1 px-[22px] max-sm:px-[14px]">
          <span>Murr клан</span>
          <span>Место, где собирается гильдия.</span>
        </div>
      </footer>
    </div>
  )
}
