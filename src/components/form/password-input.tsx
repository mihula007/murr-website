import { useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { fieldAria } from './form-field'

type PasswordInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  autoComplete: 'current-password' | 'new-password'
  error?: string | null | undefined
  hint?: ReactNode
  placeholder?: string
}

/** Поле пароля с переключателем видимости (ACC-09). */
export function PasswordInput({
  id,
  value,
  onChange,
  onBlur,
  autoComplete,
  error,
  hint,
  placeholder,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex min-w-0">
      <Input
        {...fieldAria(id, error, hint)}
        className="flex-1 rounded-r-none border-r-0"
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <button
        type="button"
        className="flex-none cursor-pointer rounded-r-lg border border-input bg-secondary px-3 text-xs text-primary"
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? 'Скрыть' : 'Показать'}
      </button>
    </div>
  )
}
