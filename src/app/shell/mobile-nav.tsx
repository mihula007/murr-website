import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { sumCounts, type NavCategory } from '@/app/navigation'
import { NavBadge } from '@/components/ui/nav-badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useActiveSection } from './use-active-section'

const sheetLinkClass =
  'flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2.5 text-[16px] text-foreground no-underline hover:bg-secondary hover:text-highlight aria-[current=page]:bg-secondary aria-[current=page]:text-highlight aria-[current=page]:shadow-[inset_2px_0_0_var(--highlight-line)]'

type MobileNavProps = {
  categories: NavCategory[]
  counts?: Partial<Record<string, number>>
}

/**
 * Мобильная навигация до `lg`: бургер открывает боковую панель. Если у роли
 * нет внутренних разделов, бургер не нужен — в шапке остаются логотип и вход.
 */
export function MobileNav({ categories, counts }: MobileNavProps) {
  // Меню помнит адрес, на котором его открыли: переход назад/вперёд или по
  // ссылке со страницы закрывает его, не оставляя панель поверх новой страницы.
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const { pathname, section: active } = useActiveSection()
  if (categories.length === 0) {
    return null
  }
  const open = openedAt === pathname
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null)
  const close = () => setOpen(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="relative -ml-2 grid size-[42px] flex-none cursor-pointer place-items-center rounded-lg border border-transparent bg-transparent text-foreground hover:border-border-strong hover:bg-secondary hover:text-highlight data-[state=open]:border-border-strong data-[state=open]:bg-secondary data-[state=open]:text-highlight lg:hidden"
        aria-label="Открыть меню"
      >
        <Menu aria-hidden="true" size={22} />
        <NavBadge
          dot
          count={sumCounts(
            categories.flatMap((category) => category.sections),
            counts,
          )}
          className="pointer-events-none absolute top-1.5 right-1.5 ring-2 ring-surface-header"
        />
      </SheetTrigger>
      <SheetContent closeLabel="Закрыть меню">
        <SheetTitle className="uppercase">Murr клан</SheetTitle>
        <SheetDescription className="sr-only">Разделы сайта</SheetDescription>
        <nav aria-label="Мобильная навигация" className="grid gap-5">
          <Link
            to="/"
            className={sheetLinkClass}
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
                className="relative m-0 px-3 py-1 font-sans text-xs font-semibold text-muted-foreground data-active:text-primary"
                data-active={active?.category === category.id ? '' : undefined}
              >
                {category.label}
              </h2>
              {category.sections.map((section) => (
                <Link
                  key={section.id}
                  to={section.path}
                  className={sheetLinkClass}
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
