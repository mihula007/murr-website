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
    <header className="shell-header">
      <div className="shell-header-inner">
        <MobileNav categories={categories} />
        <Link
          to="/"
          className="shell-brand"
          aria-label="Murr клан — на главную"
        >
          <img src={eyeIcon} alt="" width={40} height={40} />
          <span>
            Murr клан
            <small className="max-sm:hidden">Сила в единстве</small>
          </span>
        </Link>
        <DesktopNav categories={categories} />
        <div className="shell-actions">
          <AccountButton />
        </div>
      </div>
    </header>
  )
}
