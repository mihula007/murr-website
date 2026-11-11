/**
 * Запись книги Excel `.xlsx` без библиотек (Q-52). Формат `.xlsx` — это
 * ZIP-контейнер с XML-частями (Office Open XML); модуль собирает его без
 * сжатия (метод STORED), пользователь получает один файл `.xlsx`.
 * Числа пишутся числовыми ячейками, строки — встроенными строками.
 */

export type SheetCell = string | number | null
export type Sheet = { name: string; rows: SheetCell[][] }

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Управляющие символы недопустимы в XML 1.0; спецсимволы экранируются. */
function escapeXml(value: string) {
  return (
    value
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  )
}

/** Имя столбца Excel по индексу с нуля: 0 → A, 26 → AA. */
export function columnName(index: number) {
  let name = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name
  }
  return name
}

/** Имя листа: до 31 символа, без `[]:*?/\`. */
export function sheetName(name: string) {
  return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Лист'
}

function cellXml(value: SheetCell, ref: string) {
  if (value === null || value === '') {
    return ''
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
}

function sheetXml(rows: SheetCell[][]) {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, column) =>
            cellXml(value, `${columnName(column)}${rowIndex + 1}`),
          )
          .join('')}</row>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 (IEEE 802.3), как требует ZIP. */
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

type ZipEntry = { name: string; content: string }

/** ZIP без сжатия; имена в UTF-8 (флаг 0x0800). */
function zipStored(entries: ZipEntry[]) {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = encoder.encode(entry.content)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const head = new DataView(local.buffer)
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true)
    head.setUint32(14, crc, true)
    head.setUint32(18, data.length, true)
    head.setUint32(22, data.length, true)
    head.setUint16(26, name.length, true)
    local.set(name, 30)
    parts.push(local, data)

    const record = new Uint8Array(46 + name.length)
    const dir = new DataView(record.buffer)
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, data.length, true)
    dir.setUint32(24, data.length, true)
    dir.setUint16(28, name.length, true)
    dir.setUint32(42, offset, true)
    record.set(name, 46)
    central.push(record)
    offset += local.length + data.length
  }
  const size = central.reduce((sum, item) => sum + item.length, 0)
  const end = new Uint8Array(22)
  const tail = new DataView(end.buffer)
  tail.setUint32(0, 0x06054b50, true)
  tail.setUint16(8, entries.length, true)
  tail.setUint16(10, entries.length, true)
  tail.setUint32(12, size, true)
  tail.setUint32(16, offset, true)
  const result = new Uint8Array(offset + size + end.length)
  let position = 0
  for (const part of [...parts, ...central, end]) {
    result.set(part, position)
    position += part.length
  }
  return result
}

const CONTENT_TYPES = (count: number) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from(
    { length: count },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('')}</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

/** Байты книги: листы по порядку. */
export function xlsxBytes(sheets: Sheet[]) {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheetName(sheet.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('')}</sheets></workbook>`
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('')}</Relationships>`
  return zipStored([
    { name: '[Content_Types].xml', content: CONTENT_TYPES(sheets.length) },
    { name: '_rels/.rels', content: ROOT_RELS },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: sheetXml(sheet.rows),
    })),
  ])
}

/** Скачивание книги одним файлом `.xlsx`. */
export function downloadXlsx(fileName: string, sheets: Sheet[]) {
  const blob = new Blob([xlsxBytes(sheets)], { type: XLSX_MIME })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
