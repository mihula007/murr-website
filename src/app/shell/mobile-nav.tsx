import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import type { NavCategory } from '@/app/navigation'
import { NavBadge } from '@/components/ui/nav-badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useActiveSection } from './use-active-section'

type MobileNavProps = {
  categories: NavCategory[]
  counts?: Partial<Record<string, number>>
}

/**
 * Мобильная навигация до `lg`: бургер открывает боковую панель. Если у роли
 * нет внутренних разделов, бургер не нужен — в шапке остаются логотип и вход.
 */
export function MobileNav({ categories, counts }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const { pathname, section: active } = useActiveSection()
  if (categories.length === 0) return null
  const close = () => setOpen(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="shell-burger lg:hidden"
        aria-label="Открыть меню"
      >
        <Menu aria-hidden="true" size={22} />
      </SheetTrigger>
      <SheetContent closeLabel="Закрыть меню">
        <SheetTitle className="uppercase">Murr клан</SheetTitle>
        <SheetDescription className="sr-only">Разделы сайта</SheetDescription>
        <nav aria-label="Мобильная навигация" className="grid gap-5">
          <Link
            to="/"
            className="shell-sheet-link"
            aria-current={pathname === '/' ? 'page' : undefined}
            onClick={close}
          >
            Главная
          </Link>
          {categories.map((category) => (
            <section
              key={category.id}
              aria-labelledby={`mobile-nav-${category.id}`}
              className="grid gap-1"
            >
              <h2
                id={`mobile-nav-${category.id}`}
                className="shell-sheet-category"
                data-active={active?.category === category.id ? '' : undefined}
              >
                {category.label}
              </h2>
              {category.sections.map((section) => (
                <Link
                  key={section.id}
                  to={section.path}
                  className="shell-sheet-link"
                  aria-current={active?.id === section.id ? 'page' : undefined}
                  onClick={close}
                >
                  {section.label}
                  <NavBadge count={counts?.[section.id]} />
                </Link>
              ))}
            </section>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
