import { Extension, Mark, mergeAttributes, Node } from '@tiptap/core'
import { Heading } from '@tiptap/extension-heading'
import { Image } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { StarterKit } from '@tiptap/starter-kit'
import {
  isSafeImageSrc,
  isSafeLinkHref,
  isValidVideoId,
  TEXT_ALIGNS,
  TEXT_SIZES,
  TEXT_TONES,
  videoEmbedUrl,
  type TextAlign,
  type TextSize,
  type TextTone,
  type VideoProvider,
} from '@contracts/rich-text'
import { ALIGN_CLASS, RICH, SIZE_CLASS, TONE_CLASS } from './rich-text-classes'
import { videoFrameAttributes } from './video-frame'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tone: {
      setTone: (tone: TextTone) => ReturnType
      unsetTone: () => ReturnType
    }
    size: {
      setSize: (size: TextSize) => ReturnType
      unsetSize: () => ReturnType
    }
    align: {
      setAlign: (align: TextAlign) => ReturnType
    }
    video: {
      setVideo: (attrs: {
        provider: VideoProvider
        videoId: string
      }) => ReturnType
    }
  }
}

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: string | null): T | null =>
    values.includes(value as T) ? (value as T) : null

/** Цвет текста — только токены темы, класс вместо inline-стиля (Q-57). */
const Tone = Mark.create({
  name: 'tone',
  addAttributes() {
    return {
      tone: {
        default: null,
        parseHTML: (element) =>
          oneOf(TEXT_TONES)(element.getAttribute('data-tone')),
        renderHTML: (attrs) => {
          const tone = attrs.tone as TextTone | null
          return tone ? { 'data-tone': tone, class: TONE_CLASS[tone] } : {}
        },
      },
    }
  },
  parseHTML: () => [{ tag: 'span[data-tone]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
  addCommands() {
    return {
      setTone:
        (tone) =>
        ({ commands }) =>
          commands.setMark(this.name, { tone }),
      unsetTone:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

/** Размер текста — короткий набор, класс вместо inline-стиля. */
const Size = Mark.create({
  name: 'size',
  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) =>
          oneOf(TEXT_SIZES)(element.getAttribute('data-size')),
        renderHTML: (attrs) => {
          const size = attrs.size as TextSize | null
          return size ? { 'data-size': size, class: SIZE_CLASS[size] } : {}
        },
      },
    }
  },
  parseHTML: () => [{ tag: 'span[data-size]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
  addCommands() {
    return {
      setSize:
        (size) =>
        ({ commands }) =>
          commands.setMark(this.name, { size }),
      unsetSize:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

/** Выравнивание абзацев и заголовков классом (без inline-стиля). */
const Align = Extension.create({
  name: 'align',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) =>
              oneOf(TEXT_ALIGNS)(element.getAttribute('data-align')),
            renderHTML: (attrs) => {
              const align = attrs.textAlign as TextAlign | null
              return align
                ? { 'data-align': align, class: ALIGN_CLASS[align] }
                : {}
            },
          },
        },
      },
    ]
  },
  addCommands() {
    return {
      setAlign:
        (align) =>
        ({ commands }) =>
          ['paragraph', 'heading']
            .map((type) =>
              commands.updateAttributes(type, {
                textAlign: align === 'left' ? null : align,
              }),
            )
            .some(Boolean),
    }
  },
})

/** Видео YouTube/VK (Q-56): хранится провайдер и идентификатор, не URL. */
const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      provider: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-video-provider') as VideoProvider | null,
      },
      videoId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-video-id'),
      },
    }
  },
  parseHTML: () => [{ tag: 'div[data-video-provider]' }],
  renderHTML({ node }) {
    const provider = node.attrs.provider as VideoProvider
    const videoId = String(node.attrs.videoId ?? '')
    const src = isValidVideoId(provider, videoId)
      ? videoEmbedUrl(provider, videoId)
      : null
    return [
      'div',
      {
        'data-video-provider': provider,
        'data-video-id': videoId,
        class: RICH.video,
      },
      src
        ? [
            'iframe',
            {
              ...videoFrameAttributes(provider),
              src,
              class: 'size-full',
            },
          ]
        : ['span', {}, 'Видео недоступно'],
    ]
  },
  addCommands() {
    return {
      setVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})

/** Заголовок/подзаголовок (PUB-10): уровни 2–3 с классами по уровню. */
const LeveledHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level === 3 ? 3 : 2
    return [
      `h${level}`,
      mergeAttributes(HTMLAttributes, { class: RICH.heading[level] }),
      0,
    ]
  },
}).configure({ levels: [2, 3] })

/**
 * Расширения редактора — по белому списку схемы `@contracts/rich-text`:
 * без кода, без стилей текста Tiptap, ссылки и изображения — только
 * безопасные адреса (PUB-11, PUB-12).
 */
export function editorExtensions() {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: false,
      paragraph: { HTMLAttributes: { class: RICH.paragraph } },
      blockquote: { HTMLAttributes: { class: RICH.blockquote } },
      bulletList: { HTMLAttributes: { class: RICH.bulletList } },
      orderedList: { HTMLAttributes: { class: RICH.orderedList } },
      listItem: { HTMLAttributes: { class: RICH.listItem } },
      horizontalRule: { HTMLAttributes: { class: RICH.horizontalRule } },
      bold: { HTMLAttributes: { class: RICH.bold } },
      italic: { HTMLAttributes: { class: RICH.italic } },
      underline: { HTMLAttributes: { class: RICH.underline } },
      strike: { HTMLAttributes: { class: RICH.strike } },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => isSafeLinkHref(url),
        // Класс ссылки — в области редактора: Link хранит HTMLAttributes в JSON.
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      },
    }),
    LeveledHeading,
    Image.extend({
      // Только HTTPS: вставленные http/data-изображения не принимаются.
      parseHTML: () => [
        {
          tag: 'img[src]',
          getAttrs: (element) =>
            isSafeImageSrc(element.getAttribute('src') ?? '') ? null : false,
        },
      ],
    }).configure({
      allowBase64: false,
      resize: false,
      HTMLAttributes: { class: RICH.image },
    }),
    TableKit.configure({
      table: { resizable: false, HTMLAttributes: { class: RICH.table } },
      tableCell: { HTMLAttributes: { class: RICH.cell } },
      tableHeader: { HTMLAttributes: { class: RICH.headerCell } },
    }),
    Tone,
    Size,
    Align,
    Video,
  ]
}
