// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type DenoConfig = { imports: Record<string, string> }
type PackageJson = {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const deno = JSON.parse(
  readFileSync('supabase/functions/api/deno.json', 'utf8'),
) as DenoConfig
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson
const npmVersions = { ...pkg.dependencies, ...pkg.devDependencies }

describe('Edge Function imports', () => {
  it.each(Object.entries(deno.imports))(
    '%s uses the exact version from package.json',
    (name, specifier) => {
      expect(specifier).toBe(`npm:${name}@${npmVersions[name]}`)
    },
  )
})
