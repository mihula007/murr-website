import { useId } from 'react'
import { Plus, X } from 'lucide-react'
import { LIMITS } from '@contracts/account'
import {
  fieldAria,
  fieldErrorClass,
  fieldHintClass,
} from '@/components/form/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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
    <div className="grid gap-2">
      <small id={hintId} className={fieldHintClass}>
        Необязательно. До {LIMITS.equipmentLinks} ссылок на изображения
        снаряжения (например, из облака или хостинга картинок).
      </small>
      {links.map((link, index) => {
        const id = `${idPrefix}-${index}`
        const error = errors[index]
        return (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
          >
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
                className={cn(fieldErrorClass, 'col-span-full')}
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
