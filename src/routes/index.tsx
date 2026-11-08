import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './root'

function HomePage() {
  return (
    <section className="max-w-2xl space-y-6">
      <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
        Скоро здесь
      </p>
      <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">
        Сайт нашей гильдии
      </h1>
      <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
        Готовим общее пространство для участников. Здесь появятся новости,
        встречи и жизнь гильдии.
      </p>
    </section>
  )
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})
