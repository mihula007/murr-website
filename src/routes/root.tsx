import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

function RootLayout() {
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
      <header className="border-b border-[#665337] bg-[#0b0a08ed]">
        <nav
          aria-label="Основная навигация"
          className="mx-auto flex h-19 w-full max-w-[1240px] items-center px-[22px] max-sm:h-16 max-sm:px-[14px]"
        >
          <Link
            to="/"
            className="flex items-center gap-3 font-black tracking-[.13em] text-foreground no-underline"
          >
            <span aria-hidden="true" className="text-2xl text-primary">
              ✦
            </span>
            <span>
              Murr клан
              <small className="block text-[10px] font-semibold tracking-[.22em] text-muted-foreground">
                СИЛА В ЕДИНСТВЕ
              </small>
            </span>
          </Link>
        </nav>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1240px] flex-1 px-[22px] py-14 outline-none max-sm:px-[14px] max-sm:py-9"
      >
        <Outlet />
      </main>
      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        Место, где собирается гильдия.
      </footer>
    </div>
  )
}
function NotFoundPage() {
  return (
    <section className="max-w-xl space-y-6">
      <p className="text-sm text-primary">404</p>
      <h1 className="text-4xl font-bold">Страница не найдена</h1>
      <p className="text-muted-foreground">
        Проверьте адрес или вернитесь на главную страницу.
      </p>
      <Button asChild>
        <Link to="/">На главную</Link>
      </Button>
    </section>
  )
}
export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})
