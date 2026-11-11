import { Link } from '@tanstack/react-router'
import { useAccess } from '@/app/access'
import { visibleNavigation } from '@/app/navigation'
import eyeIcon from '@/assets/murrclan-eye.png'
import { AccountButton } from './account-button'
import { DesktopNav } from './desktop-nav'
import { MobileNav } from './mobile-nav'

export function Header() {
  const { role } = useAccess()
  const categories = visibleNavigation(role)
  return (
    <header className="sticky top-0 z-30 border-b border-border-strong bg-surface-header/93 backdrop-blur-[14px]">
      <div className="mx-auto flex h-[76px] w-full max-w-[1240px] items-center gap-7 px-[22px] max-lg:gap-2.5 max-[560px]:h-[66px] max-[560px]:px-3.5">
        <MobileNav categories={categories} />
        <Link
          to="/"
          className="flex min-w-0 flex-[0_1_auto] items-center gap-3 text-[13px] font-black tracking-[0.13em] whitespace-nowrap text-foreground uppercase no-underline max-[560px]:gap-2.5"
          aria-label="Murr клан — на главную"
        >
          <img
            src={eyeIcon}
            alt=""
            width={40}
            height={40}
            className="size-10 flex-none object-contain max-[560px]:size-[34px]"
          />
          <span className="min-w-0 overflow-hidden text-ellipsis">
            Murr клан
            <small className="block text-[10px] font-semibold tracking-[0.22em] text-muted-foreground max-sm:hidden">
              Сила в единстве
            </small>
          </span>
        </Link>
        <DesktopNav categories={categories} />
        <div className="ml-auto flex flex-none items-center lg:ml-0">
          <AccountButton />
        </div>
      </div>
    </header>
  )
}
