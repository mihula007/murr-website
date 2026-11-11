import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod'
import { VOTE_LIMITS, type VoteSummary } from '@contracts/votes'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { formErrorMessage, type AppError } from '@/lib/errors'
import { useUpdateVote } from './api'

const editSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'required')
    .max(VOTE_LIMITS.title, 'too_long'),
  context: z.string().trim().max(VOTE_LIMITS.context, 'too_long'),
})

type EditVoteDialogProps = {
  vote: VoteSummary
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Правка темы и контекста активного голосования (VOT-08) вместо системного
 * `prompt` прототипа. Варианты не меняются; тема голосования по заявке
 * задана системой и не редактируется.
 */
export function EditVoteDialog({
  vote,
  open,
  onOpenChange,
}: EditVoteDialogProps) {
  const update = useUpdateVote()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const titleLocked = vote.kind === 'application'

  const form = useForm({
    defaultValues: { title: vote.title, context: vote.context },
    validators: { onChange: editSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setServerError(null)
      const input = editSchema.parse(value)
      await update
        .mutateAsync({ id: vote.id, ...input })
        .then(() => {
          toast('Голосование изменено')
          close()
        })
        .catch((error: AppError) => setServerError(error))
    },
  })

  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(open && isDirty)

  function close() {
    form.reset()
    setServerError(null)
    onOpenChange(false)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !update.isPending) {
            close()
          }
        }}
      >
        <DialogContent className="w-[min(calc(100vw-28px),560px)]">
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <DialogHeader>
              <DialogTitle>Изменить голосование</DialogTitle>
              <DialogDescription>
                Варианты и голоса сохраняются.
              </DialogDescription>
            </DialogHeader>
            <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
              {(submitted) => (
                <>
                  <form.Field name="title">
                    {(field) => {
                      const error = fieldError(
                        field.state.meta,
                        submitted,
                        serverError?.fields.title,
                      )
                      const hint = titleLocked
                        ? 'Тема голосования по заявке задаётся автоматически.'
                        : undefined
                      return (
                        <FormField
                          id="vote-edit-title"
                          label="Тема"
                          hint={hint}
                          error={error}
                        >
                          <Input
                            {...fieldAria('vote-edit-title', error, hint)}
                            maxLength={VOTE_LIMITS.title}
                            readOnly={titleLocked}
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            onBlur={field.handleBlur}
                          />
                        </FormField>
                      )
                    }}
                  </form.Field>
                  <form.Field name="context">
                    {(field) => {
                      const error = fieldError(
                        field.state.meta,
                        submitted,
                        serverError?.fields.context,
                      )
                      const hint = `Необязательно, до ${VOTE_LIMITS.context} символов.`
                      return (
                        <FormField
                          id="vote-edit-context"
                          label="Контекст"
                          hint={hint}
                          error={error}
                        >
                          <Textarea
                            {...fieldAria('vote-edit-context', error, hint)}
                            rows={4}
                            maxLength={VOTE_LIMITS.context}
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            onBlur={field.handleBlur}
                          />
                        </FormField>
                      )
                    }}
                  </form.Field>
                </>
              )}
            </form.Subscribe>
            <FormError message={formErrorMessage(serverError)} />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={update.isPending}
                onClick={close}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  )
}
