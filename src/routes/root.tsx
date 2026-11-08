import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

function RootLayout() {
  return (
    <div className="flex min-h-svh flex-col">
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
      <header className="border-b border-border">
        <nav
          aria-label="Основная навигация"
          className="mx-auto flex h-18 w-full max-w-5xl items-center px-6"
        >
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Гильдия
          </Link>
        </nav>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-5xl flex-1 items-center px-6 py-20 outline-none"
      >
        <Outlet />
      </main>
      <footer className="border-t border-border px-6 py-6 text-center text-sm text-muted-foreground">
        Место, где собирается гильдия.
      </footer>
    </div>
  )
}

function NotFoundPage() {
  return (
    <section className="max-w-xl space-y-6">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-4xl font-semibold tracking-tight">
        Страница не найдена
      </h1>
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
