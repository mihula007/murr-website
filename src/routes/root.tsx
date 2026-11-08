import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { AppShell } from '@/app/shell/app-shell'
import { Button } from '@/components/ui/button'

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
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
