import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Pencil } from 'lucide-react'
import { ConfirmActionDialog } from '@/components/confirm-action-dialog'
import { EmptyState } from '@/components/states/empty-state'
import { ErrorState } from '@/components/states/error-state'
import { LoadingState } from '@/components/states/loading-state'
import { Button, buttonVariants, linkButtonClass } from '@/components/ui/button'
import { Badge, Card } from '@/components/ui/surfaces'
import { toast } from '@/components/ui/toaster'
import type { AppError } from '@/lib/errors'
import { formatDateTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import { Gallery } from './gallery'
import { authorLabel } from './material-card'
import {
  useDeleteMaterial,
  useMaterial,
  useUnpublishMaterial,
  type MaterialView,
} from './materials-api'
import { RichText } from './rich-text'
import type { MaterialSection } from './section'

export function BackToFeed({ section }: { section: MaterialSection }) {
  return (
    <Link
      to={section.path}
      className={cn(linkButtonClass, 'mb-3 inline-flex items-center gap-1.5')}
    >
      <ArrowLeft size={16} aria-hidden="true" /> К ленте «{section.texts.title}»
    </Link>
  )
}

/**
 * Полный материал (PUB-01, PUB-14, PUB-15): содержимое, вложения
 * галереей, подпись и управление для автора и администратора.
 */
export function MaterialContent({
  section,
  material,
}: {
  section: MaterialSection
  material: Pick<
    MaterialView,
    'category' | 'title' | 'summary' | 'content' | 'attachments' | 'status'
  > &
    Partial<Pick<MaterialView, 'author' | 'updatedAt'>>
}) {
  const author = material.author ? authorLabel(material.author) : null
  const files = material.attachments ?? []
  return (
    <article className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>
          {section.categoryLabels[material.category] ?? material.category}
        </Badge>
        {material.status === 'draft' ? (
          <Badge className="border-notice-border text-notice-foreground">
            Черновик
          </Badge>
        ) : null}
      </div>
      <h1 className="m-0 text-2xl leading-tight font-bold break-words sm:text-3xl">
        {material.title}
      </h1>
      {material.updatedAt || author ? (
        <p className="m-0 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
          {material.updatedAt ? (
            <span>Обновлено {formatDateTimeMsk(material.updatedAt)}</span>
          ) : null}
          {author ? <span>{author}</span> : null}
        </p>
      ) : null}
      {material.summary ? (
        <p className="m-0 text-lg break-words text-muted-foreground">
          {material.summary}
        </p>
      ) : null}
      <RichText content={material.content} />
      {files.length > 0 ? (
        <section aria-label="Вложения">
          <Gallery
            items={files.map((file) => ({
              src: file.url,
              alt: file.fileName,
              caption: file.fileName,
            }))}
          />
        </section>
      ) : null}
    </article>
  )
}

export function MaterialPage({
  section,
  id,
}: {
  section: MaterialSection
  id: string
}) {
  const navigate = useNavigate()
  const material = useMaterial(section, id)
  const unpublish = useUnpublishMaterial(section)
  const remove = useDeleteMaterial(section)
  const [confirm, setConfirm] = useState<'unpublish' | 'delete' | null>(null)

  if (material.isPending) {
    return <LoadingState label="Загружаем материал…" />
  }
  if (material.isError) {
    return (material.error as AppError).code === 'not_found' ? (
      <section>
        <BackToFeed section={section} />
        <EmptyState
          title="Материал не найден"
          description="Его удалили, сняли с публикации или он вам недоступен."
        />
      </section>
    ) : (
      <ErrorState onRetry={() => void material.refetch()} />
    )
  }
  const data = material.data

  return (
    <section className="grid gap-4">
      <div>
        <BackToFeed section={section} />
      </div>
      <Card className="grid gap-4 p-4 sm:p-6">
        <MaterialContent section={section} material={data} />
      </Card>
      {data.canManage ? (
        <div className="flex flex-wrap gap-2 max-xs:grid max-xs:grid-cols-1">
          <Link
            to={`${section.path}/$id/edit`}
            params={{ id: data.id }}
            className={buttonVariants({ className: 'no-underline' })}
          >
            <Pencil size={16} aria-hidden="true" /> Редактировать
          </Link>
          {data.status === 'published' ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirm('unpublish')}
            >
              Снять с публикации
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="text-destructive"
            onClick={() => setConfirm('delete')}
          >
            Удалить
          </Button>
        </div>
      ) : null}
      <ConfirmActionDialog
        open={confirm === 'unpublish'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Снять «${data.title}» с публикации?`}
        description="Материал станет черновиком: его увидят только автор и администратор. Опубликовать снова можно из редактора."
        confirmLabel="Снять с публикации"
        pendingLabel="Снимаем…"
        onConfirm={async () => {
          await unpublish.mutateAsync(data.id)
          toast('Снято с публикации')
        }}
      />
      <ConfirmActionDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Удалить «${data.title}»?`}
        description={section.texts.deleteDescription}
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        onConfirm={async () => {
          await remove.mutateAsync(data.id)
          toast('Удалено')
          await navigate({ to: section.path })
        }}
      />
    </section>
  )
}
