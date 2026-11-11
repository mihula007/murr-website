import { Link } from '@tanstack/react-router'
import { useAccess } from '@/app/access'
import { Button } from '@/components/ui/button'

/** Главная страница: приветствие и вход для гостя. */
export function HomePage() {
  const { status } = useAccess()
  return (
    <section className="max-w-2xl py-3">
      <p className="text-xs font-extrabold tracking-[.2em] text-primary uppercase">
        ✦ Сила в единстве ✦
      </p>
      <h1 className="mt-4 text-[clamp(38px,5vw,58px)] leading-[1.03] font-bold tracking-[-.04em]">
        Легенда продолжается
        <br />
        <span className="text-primary">Вместе с Murr</span>
      </h1>
      <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
        Готовим общее пространство для участников. Здесь появятся новости,
        встречи и жизнь гильдии.
      </p>
      {status === 'guest' ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/register">Вступить в клан</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/login">Вход</Link>
          </Button>
        </div>
      ) : null}
    </section>
  )
}
