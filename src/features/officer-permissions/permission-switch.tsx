import { cn } from '@/lib/utils'

/** Доступный переключатель разрешения, с компактной раскладкой для телефона. */
export function PermissionSwitch({
  id,
  label,
  checked,
  disabled = false,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-14 items-center justify-between gap-4 rounded-lg border border-border bg-surface-inset px-3.5 py-2.5 text-sm text-foreground max-[560px]:items-start max-[560px]:gap-3',
        disabled && 'opacity-55',
      )}
    >
      <span className="min-w-0 flex-1 leading-5">{label}</span>
      <span className="relative mt-0.5 inline-flex h-7 w-12 flex-none items-center max-[560px]:mt-1">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-border-strong bg-muted transition-colors peer-checked:border-live-border peer-checked:bg-live peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1 size-5 rounded-full border border-border-strong bg-card shadow-sm transition-transform peer-checked:translate-x-5 peer-checked:border-live-border"
        />
      </span>
    </label>
  )
}
