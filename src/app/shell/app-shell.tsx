import { lazy, Suspense, type PropsWithChildren } from 'react'
import { Header } from './header'

// import() внутри условия по константе DEV не попадает в production-сборку.
const DevRoleSwitcher = import.meta.env.DEV
  ? lazy(() => import('./dev-role-switcher'))
  : null

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="site-shell flex min-h-svh flex-col">
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
      <footer className="shell-footer">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap justify-between gap-x-6 gap-y-1 px-[22px] max-sm:px-[14px]">
          <span>Murr клан · Сила в единстве</span>
          <span>Место, где собирается гильдия.</span>
        </div>
      </footer>
      {DevRoleSwitcher ? (
        <Suspense fallback={null}>
          <DevRoleSwitcher />
        </Suspense>
      ) : null}
    </div>
  )
}
