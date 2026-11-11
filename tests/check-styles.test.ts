// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { __unstable__loadDesignSystem } from '@tailwindcss/node'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  findExtraStylesheets,
  inspectCandidates,
  inspectComponentSource,
  inspectStylesheet,
  VIRTUAL_GEOMETRY_FILE,
  type DesignSystemLike,
} from '../scripts/style-rules.ts'

const stylesheetPath = fileURLToPath(
  new URL('../src/styles.css', import.meta.url),
)
const stylesheet = readFileSync(stylesheetPath, 'utf8')
let designSystem: DesignSystemLike

beforeAll(async () => {
  designSystem = await __unstable__loadDesignSystem(stylesheet, {
    base: fileURLToPath(new URL('../src', import.meta.url)),
  })
})

function check(source: string) {
  const { candidates, findings } = inspectComponentSource(source, 'x.tsx')
  return [...findings, ...inspectCandidates(candidates, 'x.tsx', designSystem)]
}

describe('styles.css', () => {
  it('текущий файл соответствует правилам', () => {
    expect(inspectStylesheet(stylesheet)).toEqual([])
  })

  it('запрещает селекторы классов, в том числе в @layer base', () => {
    expect(inspectStylesheet('.guild-card { padding: 4px; }')).toHaveLength(2)
    expect(
      inspectStylesheet('@layer base { .shell-header { margin: 0; } }'),
    ).toEqual([expect.stringContaining('селектор класса')])
  })

  it('запрещает @layer components, @utility и @tailwind', () => {
    expect(inspectStylesheet('@layer components { a { margin: 0; } }')).toEqual(
      [expect.stringContaining('@layer components')],
    )
    expect(inspectStylesheet('@utility card { padding: 4px; }')).toEqual([
      expect.stringContaining('@utility card'),
    ])
    expect(inspectStylesheet('@tailwind utilities;')).toEqual([
      expect.stringContaining('@tailwind utilities'),
    ])
  })

  it('разрешает цвета-литералы только в :root', () => {
    expect(inspectStylesheet(':root { --card: #151412; }')).toEqual([])
    expect(inspectStylesheet('@layer base { body { color: #fff; } }')).toEqual([
      expect.stringContaining('цвет-литерал'),
    ])
    expect(
      inspectStylesheet('@theme inline { --color-x: rgb(0 0 0); }'),
    ).toEqual([expect.stringContaining('цвет-литерал')])
  })
})

describe('файлы стилей', () => {
  it('разрешает только src/styles.css', () => {
    expect(
      findExtraStylesheets([
        'src/styles.css',
        'src/app/shell.module.css',
        'stories/extra.scss',
        'src/main.tsx',
      ]),
    ).toEqual([
      expect.stringContaining('src/app/shell.module.css'),
      expect.stringContaining('stories/extra.scss'),
    ])
  })
})

describe('классы в компонентах', () => {
  it('пропускает утилиты, варианты, произвольные значения и маркеры', () => {
    expect(
      check(`
        const navLinkClass = 'group flex max-[560px]:h-[66px] [&_th]:font-semibold'
        export const A = () => (
          <div className={cn('bg-primary text-foreground hover:text-highlight', ok && 'p-4')}>
            <span className="bg-(image:--image-site) group-data-[state=open]:rotate-180" />
          </div>
        )
      `),
    ).toEqual([])
  })

  it('находит собственные классы и опечатки', () => {
    expect(
      check(
        `export const A = () => <div className="account-photo itmes-center" />`,
      ),
    ).toEqual([
      expect.stringContaining('«account-photo»'),
      expect.stringContaining('«itmes-center»'),
    ])
    expect(check(`const fieldClass = 'guild-field'`)).toEqual([
      expect.stringContaining('«guild-field»'),
    ])
    expect(check(`cn('full', className)`)).toEqual([
      expect.stringContaining('«full»'),
    ])
  })

  it('находит стандартную палитру и цвета-литералы', () => {
    expect(check(`<p className="text-white bg-red-500" />`)).toEqual([
      expect.stringContaining('«text-white»'),
      expect.stringContaining('«bg-red-500»'),
    ])
    expect(check(`<p className="bg-[#1b1914]" />`)).toEqual([
      expect.stringContaining('цвет-литерал'),
    ])
  })

  it('проверяет cva: базу и варианты, но не defaultVariants', () => {
    expect(
      check(`
        const v = cva('inline-flex', {
          variants: { variant: { default: 'bg-primary', ghost: 'guild-button-ghost' } },
          compoundVariants: [{ variant: 'ghost', className: 'legacy-class' }],
          defaultVariants: { variant: 'default' },
        })
        const b = cn(v({ variant: 'ghost' }), className)
      `),
    ).toEqual([
      expect.stringContaining('«guild-button-ghost»'),
      expect.stringContaining('«legacy-class»'),
    ])
  })

  it('проверяет classNames в объектах настроек', () => {
    expect(
      check(
        `<Sonner toastOptions={{ classNames: { toast: 'guild-toast' } }} />`,
      ),
    ).toEqual([expect.stringContaining('«guild-toast»')])
  })

  it('не проверяет части шаблонных строк рядом с подстановкой', () => {
    expect(check('<p className={`flex gap-${size} p-4`} />')).toEqual([])
  })

  it('запрещает inline-стили', () => {
    expect(check(`<div style={{ color: 'red' }} />`)).toEqual([
      expect.stringContaining('inline-стиль'),
    ])
  })

  it('разрешает только переменные --virtual-* в файле виртуализации', () => {
    const inspect = (source: string, file: string) =>
      inspectComponentSource(source, file).findings
    const geometry = `<div style={{ '--virtual-before': top } as CSSProperties} />`
    expect(inspect(geometry, VIRTUAL_GEOMETRY_FILE)).toEqual([])
    expect(inspect(geometry, 'src/components/other.tsx')).toEqual([
      expect.stringContaining('inline-стиль'),
    ])
    for (const source of [
      `<div style={{ '--virtual-before': top, color: 'red' }} />`,
      `<div style={{ '--brand': top }} />`,
      `<div style={styles} />`,
    ]) {
      expect(inspect(source, VIRTUAL_GEOMETRY_FILE)).toEqual([
        expect.stringContaining('inline-стиль'),
      ])
    }
  })
})
