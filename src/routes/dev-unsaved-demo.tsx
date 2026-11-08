import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { PageHeader } from '@/components/states/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, Field } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'

/** Демо-форма защиты от потери данных; маршрут существует только в dev. */
export default function UnsavedDemoPage() {
  const [saved, setSaved] = useState('')
  const [value, setValue] = useState('')
  const { dialog } = useUnsavedChangesGuard(value !== saved)

  return (
    <section className="max-w-xl">
      <PageHeader
        eyebrow="Только для разработки"
        title="Несохранённые изменения"
        description="Измените поле и попробуйте уйти со страницы."
      />
      <Card className="grid gap-4">
        <Field htmlFor="unsaved-demo-name">
          Имя персонажа
          <Input
            id="unsaved-demo-name"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              setSaved(value)
              toast('Изменения сохранены')
            }}
          >
            Сохранить
          </Button>
          <Button asChild variant="secondary">
            <Link to="/">На главную</Link>
          </Button>
        </div>
      </Card>
      {dialog}
    </section>
  )
}
