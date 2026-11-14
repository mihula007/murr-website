import type { ComponentProps } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

type SelectOption = { value: string; label: string; disabled?: boolean }
type SelectProps = ComponentProps<typeof SelectPrimitive.Root> & {
  options: SelectOption[]
  placeholder?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string | undefined
  'aria-invalid'?: boolean | undefined
  className?: string
}

export function Select({
  options,
  placeholder = 'Выберите вариант',
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-invalid': ariaInvalid,
  ...props
}: SelectProps) {
  return (
    <SelectPrimitive.Root {...props}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        className={cn(
          'group flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-input bg-input-background px-3 py-2.5 text-left text-base text-foreground hover:border-input-hover disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-placeholder:text-placeholder data-[state=open]:border-input-hover',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="flex flex-none text-primary group-data-[state=open]:rotate-180">
          <ChevronDown aria-hidden="true" size={18} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="z-60 max-h-[min(280px,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width) overflow-hidden rounded-xl border border-border-strong bg-popover text-foreground shadow-select"
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-primary">
            <ChevronUp size={16} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="relative flex min-h-10 cursor-pointer items-center rounded-md py-2 pr-9 pl-3 text-base outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-45 data-highlighted:bg-item-highlight data-highlighted:not-data-[state=checked]:text-accent-foreground data-[state=checked]:text-primary"
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-3 flex text-primary">
                  <Check size={16} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-primary">
            <ChevronDown size={16} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
