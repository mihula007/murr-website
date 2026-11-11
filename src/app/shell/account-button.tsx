import { Link } from '@tanstack/react-router'
import { useAccess } from '@/app/access'
import { Button } from '@/components/ui/button'

export function AccountButton() {
  const { status } = useAccess()
  return (
    <div className="flex items-center gap-2">
      {/* Слот колокольчика уведомлений — этап 10 (HOM-01: кроме гостя и чтеца). */}
      <div data-slot="notifications" className="contents" />
      <Button
        asChild
        variant="secondary"
        className="px-3.5 py-[9px] text-[13px] whitespace-nowrap"
      >
        {status === 'guest' ? (
          <Link to="/login">Вход</Link>
        ) : (
          <Link to="/account">Аккаунт</Link>
        )}
      </Button>
    </div>
  )
}
