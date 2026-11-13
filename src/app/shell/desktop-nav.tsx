import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { sumCounts, type NavCategory } from '@/app/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NavBadge } from '@/components/ui/nav-badge'
import { useActiveSection } from './use-active-section'

/** Пункт меню категорий: приглушённый текст, золотой с подсветкой-линией у активного. */
const navLinkClass =
  'relative cursor-pointer rounded-lg border-0 bg-transparent px-[13px] py-2.5 text-base font-medium whitespace-nowrap text-muted-foreground no-underline transition-colors duration-200 before:absolute before:inset-x-[13px] before:bottom-[3px] before:h-0.5 before:scale-x-45 before:rounded-sm before:bg-linear-90/srgb before:from-transparent before:via-highlight-line before:to-transparent before:opacity-0 before:drop-shadow-glow before:transition-[opacity,scale] before:duration-200 hover:text-highlight aria-[current=page]:text-highlight aria-[current=page]:before:scale-x-100 aria-[current=page]:before:opacity-100 data-active:text-highlight data-active:before:scale-x-100 data-active:before:opacity-100 data-[state=open]:text-highlight data-[state=open]:before:scale-x-100 data-[state=open]:before:opacity-100'

type DesktopNavProps = {
  categories: NavCategory[]
  /** Счётчики новых записей по id раздела (NTF-09). */
  counts?: Partial<Record<string, number>>
}

/** Меню категорий от `lg`: одновременно раскрыта одна категория (HOM-03). */
export function DesktopNav({ categories, counts }: DesktopNavProps) {
  // Открытая категория привязана к адресу: смена страницы любым способом
  // (ссылка, «Назад», переход по адресу) закрывает выпадающее меню.
  const [opened, setOpened] = useState<{ id: string; path: string } | null>(
    null,
  )
  const { pathname, section: active } = useActiveSection()
  const openId = opened?.path === pathname ? opened.id : null
  const openIdRef = useRef(openId)
  useLayoutEffect(() => {
    openIdRef.current = openId
  }, [openId])

  return (
    <nav
      aria-label="Основная навигация"
      className="ml-auto flex items-center gap-1.5 max-lg:hidden"
    >
      <Link
        to="/"
        className={navLinkClass}
        aria-current={pathname === '/' ? 'page' : undefined}
      >
        Главная
      </Link>
      {categories.map((category) => (
        <DropdownMenu
          key={category.id}
          modal={false}
          open={openId === category.id}
          onOpenChange={(open) =>
            // Закрытие первой категории при открытии второй не должно сбросить вторую.
            setOpened((current) =>
              open
                ? { id: category.id, path: pathname }
                : current?.id === category.id
                  ? null
                  : current,
            )
          }
        >
          <DropdownMenuTrigger
            className={navLinkClass}
            data-active={active?.category === category.id ? '' : undefined}
          >
            <span className="inline-flex items-center gap-1.5">
              {category.label}
              <NavBadge count={sumCounts(category.sections, counts)} />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={category.id === 'management' ? 'end' : 'start'}
            onCloseAutoFocus={(event) => {
              // Фокус остаётся в открытой следом категории, а не на этом триггере.
              if (openIdRef.current !== null) {
                event.preventDefault()
              }
            }}
          >
            {category.sections.map((section) => (
              <DropdownMenuItem key={section.id} asChild>
                <Link
                  to={section.path}
                  aria-current={active?.id === section.id ? 'page' : undefined}
                >
                  {section.label}
                  <NavBadge count={counts?.[section.id]} />
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </nav>
  )
}
