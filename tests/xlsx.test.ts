import { describe, expect, it } from 'vitest'
import { columnName, crc32, sheetName, xlsxBytes } from '@/lib/xlsx'

/** Читает несжатый ZIP: имя файла → текст и CRC из заголовка. */
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const files = new Map<string, { text: string; crc: number }>()
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    expect(view.getUint16(offset + 8, true)).toBe(0) // метод STORED
    const crc = view.getUint32(offset + 14, true)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const name = decoder.decode(
      bytes.subarray(offset + 30, offset + 30 + nameLength),
    )
    const start = offset + 30 + nameLength
    const data = bytes.subarray(start, start + size)
    expect(crc32(data)).toBe(crc)
    files.set(name, { text: decoder.decode(data), crc })
    offset = start + size
  }
  // Центральный каталог и конец архива.
  expect(view.getUint32(offset, true)).toBe(0x02014b50)
  const end = bytes.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  expect(view.getUint16(end + 10, true)).toBe(files.size)
  return files
}

describe('xlsx writer (ACT-11, Q-52)', () => {
  it('computes CRC-32 and Excel column names', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686)
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
    expect(columnName(701)).toBe('ZZ')
  })

  it('cleans sheet names for Excel', () => {
    expect(sheetName('История: мероприятий/2026')).toBe(
      'История  мероприятий 2026',
    )
    expect(sheetName('x'.repeat(40))).toHaveLength(31)
  })

  it('writes a workbook with sheets in order, numbers and escaped text', () => {
    const files = unzip(
      xlsxBytes([
        {
          name: 'Рейтинг',
          rows: [
            ['Участник', 'Посетил', 'Посещения (%)'],
            ['Анна <&> "Б"', 3, 67],
            ['Пустой', null, 0],
          ],
        },
        { name: 'История мероприятий', rows: [['Дата'], ['14.11.2026']] },
      ]),
    )
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ])
    const workbook = files.get('xl/workbook.xml')!.text
    expect(workbook.indexOf('name="Рейтинг"')).toBeLessThan(
      workbook.indexOf('name="История мероприятий"'),
    )
    const sheet = files.get('xl/worksheets/sheet1.xml')!.text
    expect(sheet).toContain('<c r="B2"><v>3</v></c>')
    expect(sheet).toContain('<c r="C2"><v>67</v></c>')
    expect(sheet).toContain('Анна &lt;&amp;&gt; &quot;Б&quot;')
    // Пустая ячейка не пишется, ноль — пишется числом.
    expect(sheet).not.toContain('r="B3"')
    expect(sheet).toContain('<c r="C3"><v>0</v></c>')
    expect(files.get('[Content_Types].xml')!.text).toContain(
      '/xl/worksheets/sheet2.xml',
    )
  })
})
