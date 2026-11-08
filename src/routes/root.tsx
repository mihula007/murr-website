import {
  createRootRoute,
  Link,
  Outlet,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { AppShell } from '@/app/shell/app-shell'
import { SplashGate } from '@/app/splash/splash'
import { ErrorState } from '@/components/states/error-state'
import { Button } from '@/components/ui/button'

function RootLayout() {
  return (
    <SplashGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </SplashGate>
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
/** Ошибка маршрута без технических подробностей; детали — в консоли. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  console.error(error)
  return <ErrorState onRetry={reset} />
}
export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})
