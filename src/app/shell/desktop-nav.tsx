import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { NavCategory } from '@/app/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NavBadge } from '@/components/ui/nav-badge'
import { useActiveSection } from './use-active-section'

type DesktopNavProps = {
  categories: NavCategory[]
  /** Счётчики новых записей по id раздела; данные появятся на этапе 10. */
  counts?: Partial<Record<string, number>>
}

/** Меню категорий от `lg`: одновременно раскрыта одна категория (HOM-03). */
export function DesktopNav({ categories, counts }: DesktopNavProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const openIdRef = useRef(openId)
  useLayoutEffect(() => {
    openIdRef.current = openId
  }, [openId])
  const { pathname, section: active } = useActiveSection()

  return (
    <nav aria-label="Основная навигация" className="shell-nav max-lg:hidden">
      <Link
        to="/"
        className="shell-nav-link"
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
            setOpenId((current) =>
              open ? category.id : current === category.id ? null : current,
            )
          }
        >
          <DropdownMenuTrigger
            className="shell-nav-link"
            data-active={active?.category === category.id ? '' : undefined}
          >
            {category.label}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={category.id === 'management' ? 'end' : 'start'}
            onCloseAutoFocus={(event) => {
              // Фокус остаётся в открытой следом категории, а не на этом триггере.
              if (openIdRef.current !== null) event.preventDefault()
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
