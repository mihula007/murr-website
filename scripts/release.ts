// Шаг 6 процесса сопровождающего (AGENTS.md): «Обычный выпуск» из
// docs/operations/deploy.md одной командой. Выкладывает только то, что
// изменилось между origin/public и main:
//   supabase/migrations/  → db push (сначала --dry-run);
//   supabase/config.toml  → config diff и config push (+ seed buckets, если
//                           менялись [storage.buckets.*]);
//   supabase/functions/   → functions deploy api;
//   всё                   → git push origin main:public и прогон «Deploy GitHub Pages».
// Перед выкладкой: main чистая и отправлена, CI для её коммита зелёный
// (ждёт, если идёт). После: проверка https://pwmurr.ru и функции api.
// Новые секреты функции скрипт не задаёт: если изменился .env.example,
// нужен флаг --secrets-checked (секреты проверены по deploy.md, п. 5).
// Запуск:
//   npm run release              — только план и готовность, ничего не меняет;
//   npm run release -- --yes     — выкладка (только после «Принять» на шаге 6).
// Значения .env передаются командам через окружение и не печатаются.
import { PROJECT_REF, hasEnv, report, run, sleep, tail } from './local-env.ts'
import { existsSync, readFileSync } from 'node:fs'

const apply = process.argv.includes('--yes')
const secretsChecked = process.argv.includes('--secrets-checked')
const SITE = 'https://pwmurr.ru/'
const API_PROBE = `https://${PROJECT_REF}.supabase.co/functions/v1/api/catalog/classes`
const done: string[] = []

function stop(message: string): never {
  report.fail(message)
  if (done.length > 0) {
    console.log(`\nУже выложено: ${done.join('; ')}.`)
  }
  console.log('\nВЫКЛАДКА ОСТАНОВЛЕНА.')
  process.exit(1)
}

function must(command: string, what: string): string {
  const result = run(command)
  if (!result.ok) {
    stop(`${what} — ошибка:\n${tail(result.out)}`)
  }
  return result.out
}

type Run = { databaseId: number; status: string; conclusion: string }

/** Последний прогон workflow для коммита; ждёт его появления до 2 минут. */
async function findRun(
  workflow: string,
  sha: string,
): Promise<Run | undefined> {
  for (let waited = 0; waited <= 120_000; waited += 10_000) {
    const runs = JSON.parse(
      must(
        `gh run list --workflow ${workflow} --commit ${sha} --limit 1 --json databaseId,status,conclusion`,
        `Список прогонов ${workflow}`,
      ),
    ) as Run[]
    if (runs[0]) {
      return runs[0]
    }
    await sleep(10_000)
  }
  return undefined
}

/** Ждёт завершения прогона; true — зелёный. */
function watchRun(id: number): boolean {
  return run(`gh run watch ${id} --exit-status --compact --interval 30`).ok
}

// 1. Ветка.
report.step('Ветка main')
if (run('git branch --show-current').out.trim() !== 'main') {
  stop('Открыта не main.')
}
if (run('git status --porcelain').out.trim()) {
  stop('Есть несохранённые изменения: сначала сохранить их коммитом.')
}
must('git fetch origin main public', 'git fetch')
const sha = must('git rev-parse HEAD', 'git rev-parse').trim()
if (sha !== must('git rev-parse origin/main', 'git rev-parse').trim()) {
  stop('main не совпадает с origin/main: сначала git push origin main.')
}
if (!run(`git merge-base --is-ancestor origin/public ${sha}`).ok) {
  stop(
    'origin/public не является предком main: fast-forward невозможен, нужен разработчик.',
  )
}
report.ok(`main ${sha.slice(0, 7)} отправлена`)

// 2. Что изменилось.
report.step('Что выкладывается')
const files = must(`git diff --name-only origin/public ${sha}`, 'git diff')
  .split(/\r?\n/)
  .filter(Boolean)
if (files.length === 0) {
  report.ok('Нечего выкладывать: сайт уже на этом коммите.')
  process.exit(0)
}
const configDiff = run(
  `git diff origin/public ${sha} -- supabase/config.toml`,
).out
const plan = {
  migrations: files.some((file) => file.startsWith('supabase/migrations/')),
  config: files.includes('supabase/config.toml'),
  buckets: /storage\.buckets/.test(configDiff),
  functions: files.some((file) => file.startsWith('supabase/functions/')),
  envExample: files.includes('.env.example'),
}
const yesNo = (value: boolean) => (value ? 'да' : 'нет')
console.log(`Файлов изменено: ${files.length}
  миграции базы:        ${yesNo(plan.migrations)}
  настройки проекта:    ${yesNo(plan.config)}${plan.buckets ? ' (+ хранилища файлов)' : ''}
  функция api:          ${yesNo(plan.functions)}
  сайт (ветка public):  да`)
if (plan.envExample) {
  report.note(
    'Изменился .env.example: если появились новые секреты функции, задать их по deploy.md, п. 5, затем запуск с --secrets-checked.',
  )
}

// 3. Готовность к выкладке.
report.step('Готовность')
const needs: string[] = []
if (plan.migrations && !hasEnv('SUPABASE_DB_PASSWORD')) {
  needs.push('SUPABASE_DB_PASSWORD')
}
if (plan.config) {
  for (const name of [
    'AUTH_SMTP_HOST',
    'AUTH_SMTP_USER',
    'AUTH_SMTP_PASS',
    'AUTH_SMTP_ADMIN_EMAIL',
    'AUTH_SMTP_SENDER_NAME',
  ]) {
    if (!hasEnv(name)) {
      needs.push(name)
    }
  }
}
if (needs.length > 0) {
  stop(`Не хватает в .env: ${needs.join(', ')}`)
}
const refFile = 'supabase/.temp/project-ref'
const backend = plan.migrations || plan.config || plan.functions
if (
  backend &&
  !(existsSync(refFile) && readFileSync(refFile, 'utf8').trim() === PROJECT_REF)
) {
  stop(
    `Проект Supabase не привязан: npx supabase link --project-ref ${PROJECT_REF}`,
  )
}
const ci = await findRun('ci.yml', sha)
if (!ci) {
  stop('Прогон CI для этого коммита не найден.')
}
if (ci.status === 'completed' && ci.conclusion !== 'success') {
  stop(
    `CI красный (${ci.conclusion}): gh run view ${ci.databaseId} --log-failed`,
  )
}
if (!apply) {
  report.ok(
    `CI: ${ci.status === 'completed' ? 'зелёный' : 'ещё идёт'} (прогон ${ci.databaseId})`,
  )
  console.log(
    '\nПЛАН ГОТОВ. Ничего не изменено; выкладка — npm run release -- --yes.',
  )
  process.exit(0)
}
if (plan.envExample && !secretsChecked) {
  stop(
    'Изменился .env.example: проверить секреты функции и запустить с --secrets-checked.',
  )
}
if (ci.status !== 'completed') {
  report.note(`CI ещё идёт, жду (прогон ${ci.databaseId})…`)
}
if (!watchRun(ci.databaseId)) {
  stop(`CI красный: gh run view ${ci.databaseId} --log-failed`)
}
report.ok('CI зелёный')

// 4. Выкладка: сначала backend, затем клиент.
if (plan.migrations) {
  report.step('Миграции базы')
  if (!run('npx supabase db push --remote --dry-run', { inherit: true }).ok) {
    stop('Проверка миграций (--dry-run) не прошла.')
  }
  if (!run('npx supabase db push --remote --yes', { inherit: true }).ok) {
    stop('Миграции не применились.')
  }
  done.push('миграции базы')
}
if (plan.config) {
  report.step('Настройки проекта')
  run('npx supabase config diff', { inherit: true })
  if (!run('npx supabase config push --yes', { inherit: true }).ok) {
    stop('Настройки не выложены.')
  }
  done.push('настройки проекта')
  if (plan.buckets) {
    if (
      !run('npx supabase seed buckets --remote --yes', { inherit: true }).ok
    ) {
      stop('Хранилища файлов не созданы.')
    }
    done.push('хранилища файлов')
  }
}
if (plan.functions) {
  report.step('Функция api')
  if (
    !run('npx supabase functions deploy api --use-api', { inherit: true }).ok
  ) {
    stop('Функция api не выложена.')
  }
  done.push('функция api')
}

report.step('Сайт')
must('git push origin main:public', 'git push origin main:public')
const pages = await findRun('pages.yml', sha)
if (!pages) {
  stop('Прогон «Deploy GitHub Pages» не найден.')
}
if (!watchRun(pages.databaseId)) {
  stop(
    `«Deploy GitHub Pages» красный: gh run view ${pages.databaseId} --log-failed`,
  )
}
done.push('сайт')
report.ok('Deploy GitHub Pages зелёный')

// 5. Проверка.
report.step('Проверка')
const site = await fetch(SITE)
const api = await fetch(API_PROBE, { method: 'POST' })
if (!site.ok || !api.ok) {
  stop(`Проверка не прошла: сайт ${site.status}, функция api ${api.status}.`)
}
report.ok(`${SITE} — ${site.status}, функция api — ${api.status}`)
console.log(`\nВЫЛОЖЕНО: ${done.join('; ')}.`)
