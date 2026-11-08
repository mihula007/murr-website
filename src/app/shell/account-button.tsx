import { Link } from '@tanstack/react-router'
import { useAccess } from '@/app/access'
import { Button } from '@/components/ui/button'

export function AccountButton() {
  const { role } = useAccess()
  return (
    <div className="flex items-center gap-2">
      {/* Слот колокольчика уведомлений — этап 10 (HOM-01: кроме гостя и чтеца). */}
      <div data-slot="notifications" className="contents" />
      <Button asChild variant="secondary" className="shell-account">
        <Link to="/account">{role === 'guest' ? 'Вход' : 'Аккаунт'}</Link>
      </Button>
    </div>
  )
}
