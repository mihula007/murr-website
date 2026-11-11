import { fieldErrorClass } from '@/components/form/form-field'
import { linkButtonClass } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useClasses } from './use-classes'

type ClassSelectProps = {
  id: string
  value: number
  onChange: (value: number) => void
  error?: string | null | undefined
}

/** Выбор класса персонажа из справочника. */
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
        <small className={fieldErrorClass}>
          Не удалось загрузить классы.{' '}
          <button
            type="button"
            className={linkButtonClass}
            onClick={() => void classes.refetch()}
          >
            Повторить
          </button>
        </small>
      ) : null}
    </>
  )
}
