import { Link } from '@tanstack/react-router'
import { useAccess } from '@/app/access'
import { Button } from '@/components/ui/button'

export function AccountButton() {
  const { status, nickname } = useAccess()
  return (
    <Button
      asChild
      variant="secondary"
      className="px-3.5 py-[9px] text-[13px] whitespace-nowrap"
    >
      {status === 'guest' ? (
        <Link to="/login">Вход</Link>
      ) : (
        <Link to="/account">{nickname || 'Аккаунт'}</Link>
      )}
    </Button>
  )
}
