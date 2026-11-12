import { Fragment } from 'react'

const MENTION = /(^|[^\p{L}\p{N}_@])(@[^\s@]{1,40})/gu

/** Части текста: обычный текст и упоминания `@ник` (DSC-07). */
export function splitMentions(body: string) {
  const parts: { text: string; mention: boolean }[] = []
  let last = 0
  for (const match of body.matchAll(MENTION)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0)
    if (start > last) {
      parts.push({ text: body.slice(last, start), mention: false })
    }
    parts.push({ text: match[2] ?? '', mention: true })
    last = start + (match[2]?.length ?? 0)
  }
  if (last < body.length) {
    parts.push({ text: body.slice(last), mention: false })
  }
  return parts
}

/**
 * Текст сообщения — только текст React, без разметки и `innerHTML`
 * (DSC-04); переносы строк сохраняются, упоминания выделены.
 */
export function MessageText({ body }: { body: string }) {
  return (
    <p className="m-0 text-sm/relaxed wrap-anywhere whitespace-pre-wrap">
      {splitMentions(body).map((part, index) =>
        part.mention ? (
          <span key={index} className="font-semibold text-primary">
            {part.text}
          </span>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </p>
  )
}
