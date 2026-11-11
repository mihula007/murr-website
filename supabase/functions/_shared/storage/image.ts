export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

/** Фактический тип изображения по сигнатуре, а не по расширению или MIME. */
export function detectImageType(head: Uint8Array): ImageType | null {
  const b = (index: number) => head[index] ?? -1
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) {
    return 'image/jpeg'
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.every((value, index) => b(index) === value)) {
    return 'image/png'
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...head.slice(from, to))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}
