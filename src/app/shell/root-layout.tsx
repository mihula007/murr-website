import { Outlet } from '@tanstack/react-router'
import { SplashGate } from '@/app/splash/splash'
import { AppShell } from './app-shell'

/** Корневой макет: заставка, оболочка и текущий маршрут. */
export function RootLayout() {
  return (
    <SplashGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </SplashGate>
  )
}
