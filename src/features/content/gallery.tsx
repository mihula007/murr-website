import { useRef, useState, type PointerEvent } from 'react'
import { ChevronLeft, ChevronRight, ImageOff, Maximize2 } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { RICH } from './rich-text-classes'

export type GalleryItem = { src: string | null; alt: string; caption?: string }

/** Порог жеста перелистывания, px. */
const SWIPE_PX = 40

const iconButton = cn(
  buttonVariants({ variant: 'secondary', size: 'icon' }),
  'size-9 rounded-full',
)

/** Изображение с сообщением при недоступном файле (PUB-14). */
function GalleryImage({
  item,
  className,
}: {
  item: GalleryItem
  className?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!item.src || failedSrc === item.src) {
    return (
      <div className="my-3 flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        <ImageOff aria-hidden className="size-6" />
        Изображение недоступно
        {item.caption ? <span className="text-xs">{item.caption}</span> : null}
      </div>
    )
  }
  return (
    <img
      src={item.src}
      alt={item.alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn(RICH.image, 'my-0', className)}
      onError={() => setFailedSrc(item.src)}
    />
  )
}

/**
 * Галерея (PUB-15): подряд идущие изображения — один блок с листанием,
 * счётчиком, увеличенным просмотром, полноэкранным режимом и жестом.
 */
export function Gallery({ items }: { items: GalleryItem[] }) {
  const [index, setIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const start = useRef<number | null>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const count = items.length
  const current = items[Math.min(index, count - 1)]
  if (!current) {
    return null
  }
  const step = (delta: number) =>
    setIndex((value) => (value + delta + count) % count)
  const swipe = {
    onPointerDown: (event: PointerEvent) => {
      start.current = event.clientX
    },
    onPointerUp: (event: PointerEvent) => {
      if (start.current === null || count < 2) {
        return
      }
      const delta = event.clientX - start.current
      start.current = null
      if (Math.abs(delta) >= SWIPE_PX) {
        step(delta < 0 ? 1 : -1)
      }
    },
  }
  const controls = count > 1 && (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        className={iconButton}
        onClick={() => step(-1)}
        aria-label="Предыдущее изображение"
      >
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <span
        className="text-sm text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        {index + 1} / {count}
      </span>
      <button
        type="button"
        className={iconButton}
        onClick={() => step(1)}
        aria-label="Следующее изображение"
      >
        <ChevronRight aria-hidden className="size-4" />
      </button>
    </div>
  )

  return (
    <figure className="my-3 grid gap-2" aria-label="Галерея изображений">
      <div className="relative touch-pan-y" {...swipe}>
        <GalleryImage item={current} className="mx-auto" />
        {current.src ? (
          <button
            type="button"
            className={cn(iconButton, 'absolute top-2 right-2')}
            onClick={() => setZoomed(true)}
            aria-label="Увеличить изображение"
          >
            <Maximize2 aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      {current.caption ? (
        <figcaption className="text-center text-xs text-muted-foreground">
          {current.caption}
        </figcaption>
      ) : null}
      {controls}
      <Dialog open={zoomed} onOpenChange={setZoomed}>
        <DialogContent className="w-[min(calc(100vw-16px),1100px)] p-3 sm:p-4">
          <DialogTitle className="sr-only">Просмотр изображения</DialogTitle>
          <DialogDescription className="sr-only">
            {current.alt || current.caption || 'Изображение'}
          </DialogDescription>
          <div
            ref={zoomRef}
            className="grid touch-pan-y place-items-center gap-3 bg-background"
            {...swipe}
          >
            <GalleryImage
              item={current}
              className="max-h-[calc(100svh-140px)] w-auto"
            />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {controls}
            <button
              type="button"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              onClick={() => void zoomRef.current?.requestFullscreen?.()}
            >
              На весь экран
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </figure>
  )
}
