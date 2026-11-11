// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  findComponentsWithoutStories,
  importedModules,
  inspectEdgeFunctions,
  inspectServerSource,
  isSqlAllowed,
} from '../scripts/architecture-rules.ts'

describe('SQL только в репозиториях', () => {
  const query = `
export async function load(db) {
  return db.selectFrom('app.profiles').selectAll().execute()
}
`

  it('находит запрос в сервисе', () => {
    const findings = inspectServerSource(
      'supabase/functions/_shared/account/service.ts',
      query,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('service.ts:3')
    expect(findings[0]).toContain('selectFrom')
  })

  it.each([
    'insertInto',
    'updateTable',
    'deleteFrom',
    'selectNoFrom',
    'replaceInto',
    'mergeInto',
  ])('находит %s', (method) => {
    expect(
      inspectServerSource(
        'supabase/functions/_shared/auth/actor.ts',
        `tx.${method}('x')`,
      ),
    ).toHaveLength(1)
  })

  it('разрешает запросы в репозиториях и слое БД', () => {
    for (const path of [
      'supabase/functions/_shared/account/repository.ts',
      'supabase/functions/_shared/db/client.ts',
    ]) {
      expect(isSqlAllowed(path)).toBe(true)
      expect(inspectServerSource(path, query)).toEqual([])
    }
  })

  it('не путает вызовы репозиториев и функции с похожим именем', () => {
    expect(
      inspectServerSource(
        'supabase/functions/_shared/account/service.ts',
        `await profileRepository.findById(tx, id)\nselectFrom('x')`,
      ),
    ).toEqual([])
  })
})

describe('истории Storybook для компонентов', () => {
  const stories = [
    {
      path: 'stories/ui.stories.tsx',
      source: `import { Button } from '../src/components/ui/button'
import { Card } from '@/components/ui/surfaces'`,
    },
  ]

  it('принимает компоненты, импортированные историями', () => {
    expect(
      findComponentsWithoutStories(
        ['src/components/ui/button.tsx', 'src/components/ui/surfaces.tsx'],
        stories,
      ),
    ).toEqual([])
  })

  it('требует историю для каждого файла ui и states', () => {
    expect(
      findComponentsWithoutStories(
        [
          'src/components/ui/button.tsx',
          'src/components/ui/avatar.tsx',
          'src/components/states/route-error.tsx',
        ],
        stories,
      ),
    ).toEqual([
      'src/components/ui/avatar.tsx: нет истории Storybook — добавьте пример в stories/*.stories.tsx',
      'src/components/states/route-error.tsx: нет истории Storybook — добавьте пример в stories/*.stories.tsx',
    ])
  })

  it('не требует историй вне ui и states', () => {
    expect(
      findComponentsWithoutStories(
        ['src/components/form/form-field.tsx', 'src/components/ui/x.ts'],
        stories,
      ),
    ).toEqual([])
  })

  it('учитывает статические, реэкспортные и динамические импорты', () => {
    expect(
      importedModules(
        'stories/a.stories.tsx',
        `import a from './a'
export { b } from './b'
export * from './c'
const d = () => import('./d')`,
      ),
    ).toEqual(['./a', './b', './c', './d'])
  })
})

describe('одна Edge Function', () => {
  it('принимает только api и общий код', () => {
    expect(inspectEdgeFunctions(['_shared', 'api'])).toEqual([])
  })

  it('отклоняет новую функцию', () => {
    expect(inspectEdgeFunctions(['_shared', 'api', 'bot'])).toEqual([
      'supabase/functions/bot: новая Edge Function — только по решению владельца (обязательна одна функция api)',
    ])
  })

  it('требует функцию api', () => {
    expect(inspectEdgeFunctions(['_shared'])).toEqual([
      'supabase/functions/api: отсутствует функция api',
    ])
  })
})
