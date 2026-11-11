import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import {
  GROUP_LIMITS,
  groupNameFormSchema,
  type GroupNameForm,
} from '@contracts/groups'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage, type AppError } from '@/lib/errors'

type GroupNameDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  initialName?: string
  /** Сохранение; ошибка сервера показывается в диалоге. */
  onSubmit: (name: string) => Promise<unknown>
}

function GroupNameFormBody({
  initialName = '',
  submitLabel,
  onDone,
  onSubmit,
}: Pick<GroupNameDialogProps, 'initialName' | 'submitLabel' | 'onSubmit'> & {
  onDone: () => void
}) {
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm({
    defaultValues: { name: initialName } as GroupNameForm,
    validators: { onChange: groupNameFormSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await onSubmit(groupNameFormSchema.parse(value).name)
        onDone()
      } catch (error) {
        setServerError(error as AppError)
        focusFirstInvalid()
      }
    },
  })
  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(isDirty)

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
        {(submitted) => (
          <form.Field name="name">
            {(field) => {
              const error = fieldError(
                field.state.meta,
                submitted,
                serverError?.fields.name,
              )
              return (
                <FormField
                  id="group-name"
                  label="Название группы"
                  error={error}
                >
                  <Input
                    {...fieldAria('group-name', error)}
                    maxLength={GROUP_LIMITS.name}
                    placeholder="Например, Пати 1"
                    value={field.state.value}
                    onChange={(change) =>
                      field.handleChange(change.target.value)
                    }
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )
            }}
          </form.Field>
        )}
      </form.Subscribe>
      <FormError message={formErrorMessage(serverError)} />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Сохраняем…' : submitLabel}
            </Button>
          </DialogFooter>
        )}
      </form.Subscribe>
      {dialog}
    </form>
  )
}

/** Создание или переименование группы (GRP-03, GRP-09). */
export function GroupNameDialog({
  open,
  onOpenChange,
  title,
  description,
  ...props
}: GroupNameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {open ? (
          <GroupNameFormBody {...props} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
