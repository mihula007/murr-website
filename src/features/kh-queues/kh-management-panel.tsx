import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/surfaces'

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
    <Card className="my-4 flex flex-wrap items-end gap-3 p-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field name="value">
          {(field) => (
            <label
              htmlFor="kh-queue-cap"
              className="flex flex-col gap-2 text-sm text-muted-foreground"
            >
              Ячеек на участника
              <Select
                id="kh-queue-cap"
                aria-label="Лимит очередей на участника"
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
        <Button type="submit">Сохранить лимит</Button>
      </form>
    </Card>
  )
}
