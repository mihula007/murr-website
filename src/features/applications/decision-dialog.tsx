import { useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { LIMITS } from '@contracts/account'
import { focusFirstInvalid } from '@/components/form/focus-first-invalid'
import { FormError } from '@/components/form/form-error'
import { FormField, fieldAria, fieldError } from '@/components/form/form-field'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { errorMessage, type AppError } from '@/lib/errors'
import { applicationKeys, useDecideApplication, type DecisionKind } from './api'

export type Decision = 'accept' | 'reject'

const noteSchema = z.object({
  note: z.string().trim().max(LIMITS.decisionNote, 'too_long'),
})

const DIRECT_COPY = {
  accept: {
    title: (nickname: string) => `Принять ${nickname} в клан?`,
    description:
      'Кандидат сразу получит роль члена клана и дату вступления — сегодня. Голосования не будет.',
    submit: 'Принять',
    pending: 'Принимаем…',
    done: 'Заявка принята',
  },
  reject: {
    title: (nickname: string) => `Отклонить заявку ${nickname}?`,
    description:
      'Кандидат увидит отказ в личном кабинете и сможет подать новую заявку.',
    submit: 'Отклонить',
    pending: 'Отклоняем…',
    done: 'Заявка отклонена',
  },
} as const

/** Окончательное решение администратора после голосования (APP-08). */
const FINAL_COPY = {
  accept: {
    ...DIRECT_COPY.accept,
    description:
      'Кандидат получит роль члена клана и дату вступления — сегодня. Итог голосования учтён вами, а не применён автоматически.',
  },
  reject: DIRECT_COPY.reject,
} as const

const COPY = { direct: DIRECT_COPY, final: FINAL_COPY } as const

type DecisionDialogProps = {
  applicationId: string
  nickname: string
  decision: Decision | null
  /** Прямое решение до голосования или окончательное после него. */
  kind?: DecisionKind
  onClose: () => void
  /** Заявку уже решил другой офицер или администратор. */
  onConflict: () => void
}

/**
 * Подтверждение прямого (APP-04) или окончательного (APP-08) решения с
 * необязательным примечанием для
 * офицеров и администраторов. Кандидату примечание не показывается.
 */
export function DecisionDialog({
  applicationId,
  nickname,
  decision,
  kind = 'direct',
  onClose,
  onConflict,
}: DecisionDialogProps) {
  const queryClient = useQueryClient()
  const decide = useDecideApplication(kind)
  const [formError, setFormError] = useState<string | null>(null)
  // Тексты закрывающегося диалога не меняются во время анимации.
  const [shown, setShown] = useState<Decision>('accept')
  if (decision && decision !== shown) {
    setShown(decision)
  }
  const copy = COPY[kind][decision ?? shown]

  const form = useForm({
    defaultValues: { note: '' },
    validators: { onChange: noteSchema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      if (!decision) {
        return
      }
      setFormError(null)
      const { note } = noteSchema.parse(value)
      await decide
        .mutateAsync({ id: applicationId, decision, note: note || null })
        .then(() => {
          toast(COPY[kind][decision].done)
          close()
        })
        .catch(async ({ code }: AppError) => {
          if (code === 'state_conflict') {
            close()
            onConflict()
            await queryClient.invalidateQueries({
              queryKey: applicationKeys.detail(applicationId),
            })
            return
          }
          setFormError(errorMessage(code))
        })
    },
  })

  const isDirty = useStore(form.store, (state) => state.isDirty)
  const { dialog } = useUnsavedChangesGuard(decision !== null && isDirty)

  function close() {
    form.reset()
    setFormError(null)
    onClose()
  }

  return (
    <>
      <AlertDialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open && !decide.isPending) {
            close()
          }
        }}
      >
        <AlertDialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <AlertDialogTitle>{copy.title(nickname)}</AlertDialogTitle>
            <AlertDialogDescription>{copy.description}</AlertDialogDescription>
            <form.Subscribe selector={(state) => state.submissionAttempts > 0}>
              {(submitted) => (
                <form.Field name="note">
                  {(field) => {
                    const error = fieldError(field.state.meta, submitted)
                    const hint = `Необязательно. Видно только офицерам и администраторам, до ${LIMITS.decisionNote} символов.`
                    return (
                      <FormField
                        id="decision-note"
                        label="Примечание"
                        hint={hint}
                        error={error}
                      >
                        <Textarea
                          {...fieldAria('decision-note', error, hint)}
                          rows={3}
                          maxLength={LIMITS.decisionNote}
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
              )}
            </form.Subscribe>
            <FormError message={formError} />
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={decide.isPending}>
                Отмена
              </AlertDialogCancel>
              <Button
                type="submit"
                variant={decision === 'reject' ? 'secondary' : 'default'}
                className={decision === 'reject' ? 'text-destructive' : ''}
                disabled={decide.isPending}
              >
                {decide.isPending ? copy.pending : copy.submit}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
      {dialog}
    </>
  )
}
