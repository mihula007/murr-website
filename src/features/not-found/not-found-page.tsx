import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

/** Неизвестный адрес. */
export function NotFoundPage() {
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
