import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

const capSchema = z.object({ value: z.number().int().min(1).max(14) })

export function KhManagementPanel({
  value,
  onSave,
}: {
  value: number
  onSave: (value: number) => void
}) {
  const form = useForm({
    defaultValues: { value },
    validators: { onChange: capSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value: formValue }) =>
      onSave(capSchema.parse(formValue).value),
  })
  return (
    <section
      aria-label="Настройка лимита очередей"
      className="flex flex-wrap items-center rounded-lg border border-border/70 bg-surface-inset px-3 py-2"
    >
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field name="value">
          {(field) => (
            <label
              htmlFor="kh-queue-cap"
              className="text-xs text-muted-foreground"
            >
              Ячеек на участника
              <Select
                id="kh-queue-cap"
                aria-label="Лимит очередей на участника"
                className="w-16 min-h-9 px-2 py-1 text-sm"
                value={String(field.state.value)}
                onValueChange={(next) => field.handleChange(Number(next))}
                options={Array.from({ length: 14 }, (_, index) => ({
                  value: String(index + 1),
                  label: String(index + 1),
                }))}
              />
            </label>
          )}
        </form.Field>
        <Button type="submit" size="sm">
          Сохранить лимит
        </Button>
      </form>
    </section>
  )
}
