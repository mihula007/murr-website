import { useEffect, useState } from 'react'
import { FormField, fieldAria } from '@/components/form/form-field'
import { Input } from '@/components/ui/input'

const RESEND_SECONDS = 60

/** Обратный отсчёт до повторной отправки кода. */
export function useCountdown() {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  return [left, () => setLeft(RESEND_SECONDS)] as const
}

/** Подпись кнопки повторной отправки с учётом отсчёта. */
export function resendLabel(cooldown: number) {
  return cooldown > 0
    ? `Отправить код ещё раз через ${cooldown} с`
    : 'Отправить код ещё раз'
}

type OtpFieldProps = {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error: string | null
}

/** Поле шестизначного кода из письма. */
export function OtpField({
  id,
  value,
  onChange,
  onBlur,
  error,
}: OtpFieldProps) {
  return (
    <FormField id={id} label="Код из письма" error={error} hint="6 цифр">
      <Input
        {...fieldAria(id, error, true)}
        className="max-w-[220px] text-center text-[26px] font-bold tracking-[0.4em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
        onBlur={onBlur}
      />
    </FormField>
  )
}
