import { Link } from '@tanstack/react-router'
import type { MaterialCard as MaterialCardData } from '@contracts/materials'
import { Badge, Card } from '@/components/ui/surfaces'
import { formatDateTimeMsk } from '@/lib/format-date'
import { cn } from '@/lib/utils'
import type { MaterialSection } from './section'

/** Подпись автора (PUB-07, PUB-17, MKT-12); скрытая — не показывается. */
export function authorLabel(author: MaterialCardData<string>['author']) {
  if (!author) {
    return null
  }
  return author.state === 'shown'
    ? `Автор: ${author.gameNickname}`
    : 'Пользователь удалён'
}

/**
 * Карточка ленты (PUB-01): категория, заголовок, анонс или начало текста,
 * первое изображение, время обновления и разрешённая подпись.
 */
export function MaterialCard({
  section,
  item,
}: {
  section: MaterialSection
  item: MaterialCardData<string>
}) {
  const author = authorLabel(item.author)
  return (
    <Card className="relative grid min-w-0 gap-3 p-4 focus-within:border-primary sm:grid-cols-[1fr_auto]">
      <div className="grid min-w-0 content-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>
            {section.categoryLabels[item.category] ?? item.category}
          </Badge>
          {item.status === 'draft' ? (
            <Badge className="border-notice-border text-notice-foreground">
              Черновик
            </Badge>
          ) : null}
        </div>
        <h2 className="m-0 text-lg leading-snug font-bold break-words">
          <Link
            to={`${section.path}/$id`}
            params={{ id: item.id }}
            className="text-foreground no-underline after:absolute after:inset-0 hover:text-primary"
          >
            {item.title}
          </Link>
        </h2>
        {item.excerpt ? (
          <p className="m-0 line-clamp-3 text-sm break-words text-muted-foreground">
            {item.excerpt}
          </p>
        ) : null}
        <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Обновлено {formatDateTimeMsk(item.updatedAt)}</span>
          {author ? <span>{author}</span> : null}
        </p>
      </div>
      {item.coverUrl ? (
        <img
          src={item.coverUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn(
            'h-40 w-full rounded-lg border border-border object-cover sm:h-28 sm:w-40',
          )}
        />
      ) : null}
    </Card>
  )
}
