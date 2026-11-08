import { Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import type { AccessRole } from '@/app/access'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/surfaces'

type ForbiddenStateProps = { accessRole: AccessRole }

/** «Нет доступа» без закрытых данных и с переходом в разрешённый контекст (HOM-15). */
export function ForbiddenState({ accessRole }: ForbiddenStateProps) {
  const isGuest = accessRole === 'guest'
  return (
    <Card className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full border border-border-accent text-primary"
      >
        <Lock size={22} />
      </span>
      <h1 className="text-2xl font-bold">Нет доступа</h1>
      <p className="max-w-md text-muted-foreground">
        {isGuest
          ? 'Этот раздел доступен только участникам клана. Войдите в аккаунт, чтобы продолжить.'
          : 'Этот раздел недоступен для вашей роли. Если считаете, что это ошибка, обратитесь к офицеру клана.'}
      </p>
      <Button asChild className="mt-2">
        {isGuest ? (
          <Link to="/account">Войти</Link>
        ) : (
          <Link to="/">На главную</Link>
        )}
      </Button>
    </Card>
  )
}
