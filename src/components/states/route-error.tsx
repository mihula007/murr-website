import type { ErrorComponentProps } from '@tanstack/react-router'
import { ErrorState } from './error-state'

/** Ошибка маршрута без технических подробностей; детали — в консоли. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  console.error(error)
  return <ErrorState onRetry={reset} />
}
