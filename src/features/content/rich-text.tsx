import type { ReactNode } from 'react'
import { renderJSONContentToReactElement } from '@tiptap/static-renderer/json/react'
import {
  CELL_ALIGNS,
  isSafeImageSrc,
  isSafeLinkHref,
  safeParseDocument,
  TEXT_ALIGNS,
  TEXT_SIZES,
  TEXT_TONES,
  videoEmbedUrl,
  type CellAlign,
  type TextAlign,
  type TextSize,
  type TextTone,
  type VideoProvider,
} from '@contracts/rich-text'
import { Notice } from '@/components/ui/surfaces'
import { cn } from '@/lib/utils'
import { Gallery, type GalleryItem } from './gallery'
import { ALIGN_CLASS, RICH, SIZE_CLASS, TONE_CLASS } from './rich-text-classes'
import {
  VIDEO_ALLOW,
  VIDEO_REFERRER_POLICY,
  VIDEO_SANDBOX,
  videoTitle,
} from './video-frame'

type JsonNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
}
type NodeProps = {
  node: JsonNode
  children?: ReactNode
  renderElement: (props: { content: JsonNode; parent?: JsonNode }) => ReactNode
}
type MarkProps = {
  mark: { attrs?: Record<string, unknown> }
  children?: ReactNode
}

const pick = <T extends string>(values: readonly T[], value: unknown) =>
  values.includes(value as T) ? (value as T) : null

const alignOf = (node: JsonNode) => {
  const align = pick<TextAlign>(TEXT_ALIGNS, node.attrs?.textAlign)
  return align ? ALIGN_CLASS[align] : undefined
}

const cellAlign = (node: JsonNode) => {
  const align = pick<CellAlign>(CELL_ALIGNS, node.attrs?.align)
  return align ? ALIGN_CLASS[align] : undefined
}

function imageItem(node: JsonNode): GalleryItem | null {
  const src = String(node.attrs?.src ?? '')
  return isSafeImageSrc(src)
    ? { src, alt: (node.attrs?.alt as string | null) ?? '' }
    : null
}

/**
 * Подряд идущие изображения документа — одна галерея (PUB-15); остальные
 * узлы рисуются по отображению ниже.
 */
function renderBlocks(
  blocks: JsonNode[],
  parent: JsonNode,
  renderElement: NodeProps['renderElement'],
) {
  const out: ReactNode[] = []
  let images: GalleryItem[] = []
  const flush = () => {
    if (images.length > 0) {
      out.push(<Gallery key={`gallery-${out.length}`} items={images} />)
      images = []
    }
  }
  for (const block of blocks) {
    const item = block.type === 'image' ? imageItem(block) : null
    if (item) {
      images.push(item)
      continue
    }
    flush()
    out.push(renderElement({ content: block, parent }))
  }
  flush()
  return out
}

function VideoFrame({
  provider,
  videoId,
}: {
  provider: VideoProvider
  videoId: string
}) {
  const src = videoEmbedUrl(provider, videoId)
  if (!src) {
    return <Notice className="my-3">Видео недоступно.</Notice>
  }
  return (
    <div className={RICH.video}>
      <iframe
        className="size-full"
        src={src}
        title={videoTitle(provider)}
        sandbox={VIDEO_SANDBOX}
        allow={VIDEO_ALLOW}
        referrerPolicy={VIDEO_REFERRER_POLICY}
        loading="lazy"
        allowFullScreen
      />
    </div>
  )
}

/**
 * Отображение узлов и меток (белый список схемы). Неизвестный узел или метка
 * не рисуются: документ уже прошёл схему, это второй слой защиты.
 */
const renderDocument = () =>
  renderJSONContentToReactElement({
    nodeMapping: {
      doc: ({ node, renderElement }: NodeProps) => (
        <>{renderBlocks(node.content ?? [], node, renderElement)}</>
      ),
      text: ({ node }: NodeProps) => <>{node.text}</>,
      paragraph: ({ node, children }: NodeProps) => (
        <p className={cn(RICH.paragraph, alignOf(node))}>{children}</p>
      ),
      heading: ({ node, children }: NodeProps) =>
        node.attrs?.level === 3 ? (
          <h3 className={cn(RICH.heading[3], alignOf(node))}>{children}</h3>
        ) : (
          <h2 className={cn(RICH.heading[2], alignOf(node))}>{children}</h2>
        ),
      blockquote: ({ node, renderElement }: NodeProps) => (
        <blockquote className={RICH.blockquote}>
          {renderBlocks(node.content ?? [], node, renderElement)}
        </blockquote>
      ),
      bulletList: ({ children }: NodeProps) => (
        <ul className={RICH.bulletList}>{children}</ul>
      ),
      orderedList: ({ node, children }: NodeProps) => (
        <ol
          className={RICH.orderedList}
          start={
            typeof node.attrs?.start === 'number' ? node.attrs.start : undefined
          }
        >
          {children}
        </ol>
      ),
      listItem: ({ children }: NodeProps) => (
        <li className={RICH.listItem}>{children}</li>
      ),
      hardBreak: () => <br />,
      horizontalRule: () => <hr className={RICH.horizontalRule} />,
      table: ({ children }: NodeProps) => (
        <div className={RICH.tableWrap}>
          <table className={RICH.table}>
            <tbody>{children}</tbody>
          </table>
        </div>
      ),
      tableRow: ({ children }: NodeProps) => <tr>{children}</tr>,
      tableCell: ({ node, children }: NodeProps) => (
        <td
          className={cn(RICH.cell, cellAlign(node))}
          colSpan={Number(node.attrs?.colspan ?? 1)}
          rowSpan={Number(node.attrs?.rowspan ?? 1)}
        >
          {children}
        </td>
      ),
      tableHeader: ({ node, children }: NodeProps) => (
        <th
          className={cn(RICH.headerCell, cellAlign(node))}
          colSpan={Number(node.attrs?.colspan ?? 1)}
          rowSpan={Number(node.attrs?.rowspan ?? 1)}
        >
          {children}
        </th>
      ),
      image: ({ node }: NodeProps) => {
        const item = imageItem(node)
        return item ? <Gallery items={[item]} /> : null
      },
      video: ({ node }: NodeProps) => (
        <VideoFrame
          provider={node.attrs?.provider as VideoProvider}
          videoId={String(node.attrs?.videoId ?? '')}
        />
      ),
    },
    markMapping: {
      bold: ({ children }: MarkProps) => (
        <strong className={RICH.bold}>{children}</strong>
      ),
      italic: ({ children }: MarkProps) => (
        <em className={RICH.italic}>{children}</em>
      ),
      underline: ({ children }: MarkProps) => (
        <u className={RICH.underline}>{children}</u>
      ),
      strike: ({ children }: MarkProps) => (
        <s className={RICH.strike}>{children}</s>
      ),
      link: ({ mark, children }: MarkProps) => {
        const href = String(mark.attrs?.href ?? '')
        return isSafeLinkHref(href) ? (
          <a
            className={RICH.link}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {children}
          </a>
        ) : (
          <>{children}</>
        )
      },
      tone: ({ mark, children }: MarkProps) => {
        const tone = pick<TextTone>(TEXT_TONES, mark.attrs?.tone)
        return (
          <span className={tone ? TONE_CLASS[tone] : undefined}>
            {children}
          </span>
        )
      },
      size: ({ mark, children }: MarkProps) => {
        const size = pick<TextSize>(TEXT_SIZES, mark.attrs?.size)
        return (
          <span className={size ? SIZE_CLASS[size] : undefined}>
            {children}
          </span>
        )
      },
    },
    unhandledNode: () => null,
    unhandledMark: ({ children }: MarkProps) => <>{children}</>,
  })

/**
 * Показ документа в ленте, на странице материала и в предпросмотре
 * (PUB-04). Документ ещё раз проверяется схемой; не прошедший её не
 * показывается вовсе, а не «как есть».
 */
export function RichText({
  content,
  className,
}: {
  content: unknown
  className?: string
}) {
  const doc = safeParseDocument(content)
  if (!doc) {
    return (
      <Notice className={className}>
        Содержимое материала повреждено и не может быть показано.
      </Notice>
    )
  }
  return (
    <div className={cn('min-w-0 text-foreground', className)}>
      {renderDocument()({ content: doc as JsonNode })}
    </div>
  )
}
