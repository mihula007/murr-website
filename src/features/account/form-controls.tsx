import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { LIMITS } from '@contracts/account'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useClasses } from '@/features/auth/use-classes'
import { fieldMessage } from '@/lib/api/messages'
import { cn } from '@/lib/utils'

/** Атрибуты доступности для поля с ошибкой и подсказкой. */
export function fieldAria(
  id: string,
  error?: string | null | undefined,
  hint?: ReactNode,
) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ')
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  } as const
}

type FieldMeta = {
  errors: unknown[]
  isTouched: boolean
  isBlurred?: boolean
}

/**
 * Текст первой ошибки поля TanStack Form. Ошибки показываются после ухода с
 * поля или после попытки отправки; серверная ошибка поля имеет приоритет.
 */
export function fieldError(
  meta: FieldMeta,
  submitted: boolean,
  serverCode?: string,
) {
  if (serverCode) return fieldMessage(serverCode)
  if (!submitted && !(meta.isTouched && meta.isBlurred)) return null
  const first = meta.errors.find(Boolean)
  if (!first) return null
  const code =
    typeof first === 'string'
      ? first
      : String((first as { message?: string }).message ?? '')
  return fieldMessage(code)
}

type FormFieldProps = {
  id: string
  label: ReactNode
  error?: string | null | undefined
  hint?: ReactNode
  className?: string
  children: ReactNode
}

export function FormField({
  id,
  label,
  error,
  hint,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn('guild-field', className)}>
      <label htmlFor={id} className="form-label">
        {label}
      </label>
      {children}
      {hint ? (
        <small id={`${id}-hint`} className="field-hint">
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={`${id}-error`} className="field-error">
          {error}
        </small>
      ) : null}
    </div>
  )
}

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
    <div className="password-input-wrap">
      <Input
        {...fieldAria(id, error, hint)}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? 'Скрыть' : 'Показать'}
      </button>
    </div>
  )
}

type ClassSelectProps = {
  id: string
  value: number
  onChange: (value: number) => void
  error?: string | null | undefined
}

export function ClassSelect({ id, value, onChange, error }: ClassSelectProps) {
  const classes = useClasses()
  return (
    <>
      <Select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder={classes.isPending ? 'Загружаем классы…' : 'Выбери класс'}
        value={value ? String(value) : ''}
        onValueChange={(next) => onChange(Number(next))}
        options={(classes.data ?? []).map((item) => ({
          value: String(item.id),
          label: item.name,
        }))}
      />
      {classes.isError ? (
        <small className="field-error">
          Не удалось загрузить классы.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => void classes.refetch()}
          >
            Повторить
          </button>
        </small>
      ) : null}
    </>
  )
}

type AvatarPickerProps = {
  id: string
  /** Новый файл (после сжатия) или null. */
  file: Blob | null
  /** Ссылка на текущий аватар профиля, если файл не выбран. */
  currentUrl?: string | null
  fallback: string
  onSelect: (file: File) => void
  onRemove?: () => void
  busy?: boolean
  error?: string | null | undefined
}

/** Выбор аватара с предпросмотром до сохранения (ACC-08). */
export function AvatarPicker({
  id,
  file,
  currentUrl,
  fallback,
  onSelect,
  onRemove,
  busy,
  error,
}: AvatarPickerProps) {
  const preview = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  )
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )
  const shown = preview ?? currentUrl ?? null
  const hint = 'JPEG, PNG или WebP до 500 КБ; уменьшается до 512 px'
  return (
    <div className="avatar-picker">
      <div className="avatar-preview" aria-hidden={shown ? undefined : true}>
        {shown ? (
          <img src={shown} alt="Предпросмотр аватара" />
        ) : (
          <span>{fallback}</span>
        )}
      </div>
      <div className="avatar-picker-controls">
        <input
          {...fieldAria(id, error, hint)}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="guild-input avatar-file"
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files?.[0]
            if (selected) onSelect(selected)
            event.target.value = ''
          }}
        />
        {onRemove && shown ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRemove}
          >
            Убрать фото
          </Button>
        ) : null}
      </div>
    </div>
  )
}

type EquipmentLinksProps = {
  idPrefix: string
  links: string[]
  onChange: (links: string[]) => void
  errors?: (string | null)[]
}

/** До 10 необязательных ссылок на скриншоты снаряжения; файлы не загружаются (Q-11). */
export function EquipmentLinks({
  idPrefix,
  links,
  onChange,
  errors = [],
}: EquipmentLinksProps) {
  const hintId = useId()
  return (
    <div className="equipment-links">
      <small id={hintId} className="field-hint">
        Необязательно. До {LIMITS.equipmentLinks} ссылок на изображения
        снаряжения (например, из облака или хостинга картинок).
      </small>
      {links.map((link, index) => {
        const id = `${idPrefix}-${index}`
        const error = errors[index]
        return (
          <div key={index} className="equipment-link-row">
            <Input
              {...fieldAria(id, error)}
              aria-label={`Ссылка ${index + 1}`}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={link}
              onChange={(event) =>
                onChange(
                  links.map((item, i) =>
                    i === index ? event.target.value : item,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Удалить ссылку ${index + 1}`}
              onClick={() => onChange(links.filter((_, i) => i !== index))}
            >
              <X size={18} aria-hidden="true" />
            </Button>
            {error ? (
              <small
                id={`${id}-error`}
                className="field-error equipment-link-error"
              >
                {error}
              </small>
            ) : null}
          </div>
        )
      })}
      {links.length < LIMITS.equipmentLinks ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="justify-self-start"
          aria-describedby={hintId}
          onClick={() => onChange([...links, ''])}
        >
          <Plus size={16} aria-hidden="true" /> Добавить ссылку
        </Button>
      ) : null}
    </div>
  )
}
