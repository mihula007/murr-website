// Наполнение ЛОКАЛЬНОГО Supabase тестовыми данными: ~160 пользователей всех
// ролей и 100+ записей в каждом разделе (заявки, голосования, события,
// публикации, барахолка, обсуждения, уведомления, аудит, рассылки).
// Запуск: node scripts/seed-dev.ts [--reset] (npm run seed:dev — с --reset)
//   --reset — очистить прикладные таблицы и всех пользователей Auth перед
//   наполнением (только локальный стек). Без флага повторный запуск
//   отклоняется, если сид уже есть.
// Вход: seed-admin@example.test, seed-officer-1@…, seed-member-1@… —
// пароль TEST_PASSWORD из tests/server/support.ts.
// Вставки идут в обход сервисов — это фикстура, а не бизнес-логика; поэтому
// здесь (и только здесь) разрешён прямой драйвер postgres (.oxlintrc.json).
// Внимание: `npm run test:server` и e2e очищают прикладные таблицы.
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { APPLICATION_VOTE_OPTIONS } from '../supabase/functions/_shared/contracts/votes.ts'
import type { RichDocument } from '../supabase/functions/_shared/contracts/rich-text.ts'
import { deriveFields } from '../supabase/functions/_shared/materials/derive.ts'
import { TEST_PASSWORD } from '../tests/server/support.ts'

type Status = { DB_URL: string; API_URL: string; SERVICE_ROLE_KEY: string }
const status = JSON.parse(
  execSync('npx supabase status -o json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
) as Status
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(status.DB_URL)) {
  throw new Error('Сид разрешён только для локального Supabase')
}

const reset = process.argv.includes('--reset')
const sql = postgres(status.DB_URL, { max: 4, onnotice: () => {} })

// Детерминированный генератор: одинаковые данные при каждом запуске.
let seed = 20261114
function rand() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1))
const pick = <T>(items: readonly T[]) =>
  items[Math.floor(rand() * items.length)]!
const chance = (p: number) => rand() < p
function sample<T>(items: readonly T[], count: number) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy.slice(0, Math.min(count, copy.length))
}

const NOW = Date.now()
const DAY = 86_400_000
const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const daysAgo = (days: number) => NOW - days * DAY
const dateOnly = (ms: number) => iso(ms).slice(0, 10)

const NAMES = [
  'Анна',
  'Борис',
  'Вера',
  'Глеб',
  'Дарья',
  'Егор',
  'Жанна',
  'Илья',
  'Кира',
  'Лев',
  'Мария',
  'Никита',
  'Ольга',
  'Павел',
  'Роман',
  'Софья',
  'Тимур',
  'Ульяна',
  'Фёдор',
  'Юлия',
  'Яна',
  'Артём',
  'Денис',
  'Максим',
  'Алиса',
  'Полина',
  'Кирилл',
  'Ева',
]
const NICK_ROOTS = [
  'Murr',
  'Shadow',
  'Frost',
  'Wolf',
  'Raven',
  'Storm',
  'Blaze',
  'Lynx',
  'Night',
  'Ember',
  'Sky',
  'Thorn',
  'Fang',
  'Ash',
  'Iron',
  'Mist',
  'Vex',
  'Rune',
  'Kai',
  'Zed',
]
const CITIES = [
  'Москва',
  'Санкт-Петербург',
  'Казань',
  'Новосибирск',
  'Екатеринбург',
  'Минск',
  'Самара',
  'Пермь',
  'Краснодар',
  null,
]
const LOREM = [
  'Собираемся заранее, проверяем расходники и баффы.',
  'Тактика та же, что и на прошлой неделе, но меняем порядок пулов.',
  'Новичкам — держаться рядом с лидером группы и слушать голосовой канал.',
  'Награды делим по таблице активности, спорные случаи решают офицеры.',
  'Если не успеваете к старту, напишите в обсуждении события.',
  'Отличный результат, спасибо всем, кто пришёл вовремя!',
  'Рекомендуемый уровень снаряжения указан в описании.',
  'Пожалуйста, отмечайте присутствие хотя бы за день.',
  'В этот раз пробуем новую расстановку по группам.',
  'Вопросы по правилам задавайте офицерам в личных сообщениях.',
]
const text = (sentences: number) =>
  Array.from({ length: sentences }, () => pick(LOREM)).join(' ')

function doc(title: string, paragraphs: number): RichDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: title }],
      },
      ...Array.from({ length: paragraphs }, () => ({
        type: 'paragraph' as const,
        content: [{ type: 'text' as const, text: text(int(2, 4)) }],
      })),
      {
        type: 'bulletList',
        content: Array.from({ length: int(2, 4) }, () => ({
          type: 'listItem' as const,
          content: [
            {
              type: 'paragraph' as const,
              content: [{ type: 'text' as const, text: pick(LOREM) }],
            },
          ],
        })),
      },
    ],
  }
}

async function createAuthUsers(emails: string[]) {
  const ids = new Map<string, string>()
  let next = 0
  async function worker() {
    while (next < emails.length) {
      const email = emails[next++]!
      const response = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: status.SERVICE_ROLE_KEY,
          Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password: TEST_PASSWORD,
          email_confirm: true,
        }),
      })
      const body = (await response.json()) as { id?: string; msg?: string }
      if (!response.ok || !body.id) {
        throw new Error(`Не создан ${email}: ${body.msg ?? response.status}`)
      }
      ids.set(email, body.id)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return ids
}

const APP_TABLES = [
  'audit_log',
  'application_equipment_links',
  'join_applications',
  'votes',
  'vote_options',
  'vote_ballots',
  'events',
  'event_attendance',
  'event_groups',
  'event_group_members',
  'event_activity_records',
  'event_templates',
  'group_templates',
  'group_template_groups',
  'group_template_members',
  'publications',
  'publication_attachments',
  'market_listings',
  'discussion_threads',
  'discussion_messages',
  'discussion_reactions',
  'discussion_reads',
  'user_notifications',
  'section_views',
  'broadcast_templates',
  'broadcast_drafts',
  'user_deletions',
  'profiles',
]

async function insert(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await sql`insert into ${sql(`app.${table}`)} ${sql(rows.slice(i, i + 500) as never)}`
  }
  console.log(`  ${table}: ${rows.length}`)
}

if (reset) {
  console.log('Очистка локальных данных…')
  await sql.unsafe(
    `truncate ${APP_TABLES.map((t) => `app.${t}`).join(', ')} restart identity cascade`,
  )
  await sql`delete from auth.users`
} else {
  const [existing] =
    await sql`select count(*)::int as n from auth.users where email = 'seed-admin@example.test'`
  if (existing!.n > 0) {
    console.error(
      'Сид уже есть. Повторите с --reset, чтобы пересоздать данные.',
    )
    await sql.end()
    process.exit(1)
  }
  const [primary] =
    await sql`select count(*)::int as n from app.profiles where is_primary_admin`
  if (primary!.n > 0) {
    console.error('Главный администратор уже назначен. Запустите с --reset.')
    await sql.end()
    process.exit(1)
  }
}

// ---------- Пользователи ----------
type Role = 'applicant' | 'reader' | 'member' | 'officer' | 'admin'
const PLAN: [Role, number][] = [
  ['admin', 3],
  ['officer', 8],
  ['member', 100],
  ['reader', 15],
  ['applicant', 34],
]
type User = {
  id: string
  email: string
  role: Role
  nickname: string
  classId: number
  createdAt: number
  primary: boolean
}

const classes = (
  await sql`select id from app.character_classes where is_active order by id`
).map((row) => row.id as number)
const specs: Omit<User, 'id'>[] = []
for (const [role, count] of PLAN) {
  for (let i = 1; i <= count; i += 1) {
    const primary = role === 'admin' && i === 1
    const n = specs.length + 1
    specs.push({
      email: primary
        ? 'seed-admin@example.test'
        : `seed-${role}-${i}@example.test`,
      role,
      primary,
      nickname: `${pick(NICK_ROOTS).slice(0, 5)}${String(n).padStart(3, '0')}`,
      classId: pick(classes),
      createdAt:
        role === 'applicant' ? daysAgo(int(1, 40)) : daysAgo(int(60, 400)),
    })
  }
}
console.log(`Создание ${specs.length} пользователей Auth…`)
const authIds = await createAuthUsers(specs.map((s) => s.email))
const users: User[] = specs.map((s) => ({ ...s, id: authIds.get(s.email)! }))
const byRole = (...roles: Role[]) => users.filter((u) => roles.includes(u.role))
const staff = byRole('officer', 'admin')
const clan = byRole('member', 'officer', 'admin')
const registered = users

console.log('Вставка данных:')
await insert(
  'profiles',
  users.map((u) => ({
    id: u.id,
    display_name: pick(NAMES),
    game_nickname: u.nickname,
    city: pick(CITIES),
    birth_date: chance(0.7)
      ? `${int(1980, 2006)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`
      : null,
    class_id: u.classId,
    about: chance(0.6) ? text(int(1, 3)) : null,
    access_role: u.role,
    is_primary_admin: u.primary,
    joined_on: ['member', 'officer', 'admin'].includes(u.role)
      ? dateOnly(u.createdAt + int(1, 10) * DAY)
      : null,
    created_at: iso(u.createdAt),
    updated_at: iso(u.createdAt + int(0, 30) * DAY),
  })),
)

// ---------- Заявки и голосования ----------
const applications: Record<string, unknown>[] = []
const links: Record<string, unknown>[] = []
const votes: Record<string, unknown>[] = []
const options: Record<string, unknown>[] = []
const ballots: Record<string, unknown>[] = []
const voteOptionIds = new Map<string, string[]>()

function addVote(v: {
  kind: 'general' | 'application'
  title: string
  context: string
  createdAt: number
  closedAt: number | null
  applicationId: string | null
  labels: readonly string[]
}) {
  const id = randomUUID()
  const author = pick(staff)
  votes.push({
    id,
    kind: v.kind,
    title: v.title,
    context: v.context,
    created_by: author.id,
    application_id: v.applicationId,
    closed_at: v.closedAt ? iso(v.closedAt) : null,
    closed_by: v.closedAt ? pick(staff).id : null,
    created_at: iso(v.createdAt),
    updated_at: iso(v.closedAt ?? v.createdAt),
  })
  const ids = v.labels.map((label, position) => {
    const optionId = randomUUID()
    options.push({
      id: optionId,
      vote_id: id,
      label,
      normalized_label: label.trim().toLocaleLowerCase('ru'),
      position,
    })
    return optionId
  })
  voteOptionIds.set(id, ids)
  for (const voter of sample(
    clan,
    Math.floor(clan.length * (0.3 + rand() * 0.6)),
  )) {
    const at = v.createdAt + int(1, 48) * HOUR
    ballots.push({
      vote_id: id,
      option_id: pick(ids),
      voter_id: voter.id,
      created_at: iso(at),
      updated_at: iso(at),
    })
  }
  return id
}

function addApplication(
  applicant: User,
  statusName: string,
  submittedAt: number,
) {
  const id = randomUUID()
  const decided = [
    'officer_approved',
    'officer_rejected',
    'admin_approved',
    'admin_rejected',
  ].includes(statusName)
  const decidedAt = decided ? submittedAt + int(1, 6) * DAY : null
  applications.push({
    id,
    applicant_id: applicant.id,
    status: statusName,
    submitted_at: iso(submittedAt),
    decided_at: decidedAt ? iso(decidedAt) : null,
    decided_by: decided ? pick(staff).id : null,
    decision_note: decided && chance(0.5) ? text(1) : null,
    created_at: iso(submittedAt),
    updated_at: iso(decidedAt ?? submittedAt),
  })
  for (let position = 0; position < int(1, 3); position += 1) {
    links.push({
      application_id: id,
      url: `https://example.com/gear/${applicant.nickname}-${position}.png`,
      position,
    })
  }
  return { id, decidedAt }
}

for (const user of byRole('member', 'officer', 'admin', 'reader')) {
  if (user.primary) {
    continue
  }
  const approved = user.role !== 'reader'
  const statusName = approved
    ? pick(['officer_approved', 'admin_approved'])
    : 'officer_rejected'
  const submitted = user.createdAt + HOUR
  const app = addApplication(user, statusName, submitted)
  if (approved && chance(0.4)) {
    addVote({
      kind: 'application',
      title: `Заявка: ${user.nickname}`,
      context: '',
      createdAt: submitted + DAY / 2,
      closedAt: app.decidedAt! - HOUR,
      applicationId: app.id,
      labels: APPLICATION_VOTE_OPTIONS,
    })
  }
}
byRole('applicant').forEach((user, index) => {
  const submitted = user.createdAt + HOUR
  if (index % 4 === 0) {
    addApplication(user, 'officer_rejected', submitted - 20 * DAY)
  }
  const statusName =
    index < 14
      ? 'pending_officer_review'
      : index < 24
        ? 'pending_vote'
        : index < 30
          ? 'vote_completed'
          : 'admin_rejected'
  const app = addApplication(user, statusName, submitted)
  if (statusName === 'pending_vote' || statusName === 'vote_completed') {
    addVote({
      kind: 'application',
      title: `Заявка: ${user.nickname}`,
      context: '',
      createdAt: submitted + HOUR,
      closedAt: statusName === 'vote_completed' ? submitted + 3 * DAY : null,
      applicationId: app.id,
      labels: APPLICATION_VOTE_OPTIONS,
    })
  }
})
const VOTE_TOPICS = [
  'Время рейда по субботам',
  'Новый лидер ПВП-группы',
  'Правило распределения добычи',
  'Перенос события',
  'Цвет кланового знамени',
  'Турнир внутри клана',
  'Клановый налог',
  'Набор новичков',
  'Выбор осады',
  'Голосовой сервер',
]
const OPTION_POOL = [
  'Да',
  'Нет',
  'Воздержусь',
  'Пятница',
  'Суббота',
  'Воскресенье',
  '20:00',
  '21:00',
  '22:00',
  'Вариант А',
  'Вариант Б',
  'Перенести обсуждение',
]
const generalVotes: string[] = []
for (let i = 1; i <= 110; i += 1) {
  const createdAt = daysAgo(int(0, 300))
  const closed = i > 30
  generalVotes.push(
    addVote({
      kind: 'general',
      title: `${pick(VOTE_TOPICS)} №${i}`,
      context: chance(0.7) ? text(int(1, 3)) : '',
      createdAt,
      closedAt: closed
        ? Math.min(createdAt + int(1, 7) * DAY, NOW - HOUR)
        : null,
      applicationId: null,
      labels: sample(OPTION_POOL, int(2, 6)),
    }),
  )
}
await insert('join_applications', applications)
await insert('application_equipment_links', links)
await insert('votes', votes)
await insert('vote_options', options)
await insert('vote_ballots', ballots)

// ---------- События ----------
const EVENT_TITLES: Record<string, string[]> = {
  pvp: ['Осада крепости', 'Арена 5×5', 'Битва за ресурсы', 'Война гильдий'],
  pve: ['Рейд в Подземелье', 'Мировой босс', 'Фарм данжей', 'Охота на элиту'],
  clan: [
    'Клановое собрание',
    'Турнир клана',
    'Фотосессия клана',
    'Обучение новичков',
  ],
}
const events: Record<string, unknown>[] = []
const attendance: Record<string, unknown>[] = []
const groups: Record<string, unknown>[] = []
const groupMembers: Record<string, unknown>[] = []
const activity: Record<string, unknown>[] = []
const eventIds: string[] = []

for (let i = 0; i < 140; i += 1) {
  const id = randomUUID()
  eventIds.push(id)
  const type = pick(['pvp', 'pve', 'clan'] as const)
  const past = i < 105
  const startsAt = past
    ? daysAgo(int(1, 200)) + int(18, 22) * HOUR
    : NOW + int(1, 45) * DAY
  const closed = past && i < 100
  const createdAt = Math.min(startsAt - int(2, 10) * DAY, NOW - HOUR)
  events.push({
    id,
    title: pick(EVENT_TITLES[type]!),
    event_type: type,
    description: text(int(1, 4)),
    starts_at: iso(startsAt),
    recurring_preset: null,
    created_by: pick(staff).id,
    closed_at: closed ? iso(startsAt + 3 * HOUR) : null,
    closed_by: closed ? pick(staff).id : null,
    created_at: iso(createdAt),
    updated_at: iso(createdAt),
  })
  const eligible = clan.filter((u) => u.createdAt < startsAt)
  const answers = new Map<string, string>()
  for (const user of sample(
    eligible,
    Math.floor(eligible.length * (0.4 + rand() * 0.5)),
  )) {
    const answer = pick(['yes', 'yes', 'yes', 'maybe', 'no'])
    answers.set(user.id, answer)
    attendance.push({
      event_id: id,
      user_id: user.id,
      answer,
      answered_at: iso(Math.min(createdAt + int(1, 48) * HOUR, NOW)),
    })
  }
  const inGroup = new Map<string, { name: string; leader: boolean }>()
  if (closed || chance(0.5)) {
    const going = sample(
      [...answers].filter(([, a]) => a !== 'no').map(([userId]) => userId),
      40,
    )
    const groupCount = Math.max(1, Math.ceil(going.length / 6))
    for (let g = 0; g < groupCount; g += 1) {
      const groupId = randomUUID()
      const name = `Пати ${g + 1}`
      groups.push({
        id: groupId,
        event_id: id,
        name,
        created_at: iso(createdAt + g),
      })
      going.slice(g * 6, g * 6 + 6).forEach((userId, position) => {
        groupMembers.push({
          event_id: id,
          user_id: userId,
          group_id: groupId,
          position,
          is_leader: position === 0,
        })
        inGroup.set(userId, { name, leader: position === 0 })
      })
    }
  }
  if (closed) {
    for (const user of eligible) {
      const group = inGroup.get(user.id)
      activity.push({
        event_id: id,
        user_id: user.id,
        nickname: user.nickname,
        class_id: user.classId,
        status: group
          ? 'visited'
          : answers.has(user.id)
            ? 'missed'
            : 'unmarked',
        group_name: group?.name ?? null,
        is_leader: group?.leader ?? false,
      })
    }
  }
}
await insert('events', events)
await insert('event_attendance', attendance)
await insert('event_groups', groups)
await insert('event_group_members', groupMembers)
await insert('event_activity_records', activity)

await insert(
  'event_templates',
  Array.from({ length: 100 }, (_, i) => {
    const type = pick(['pvp', 'pve', 'clan'] as const)
    return {
      title: `${pick(EVENT_TITLES[type]!)} (шаблон ${i + 1})`,
      event_type: type,
      description: text(2),
      weekday: int(0, 6),
      time_msk: `${int(17, 23)}:${pick(['00', '30'])}:00`,
      created_by: pick(staff).id,
      created_at: iso(daysAgo(int(1, 200))),
    }
  }),
)

const templates: Record<string, unknown>[] = []
const templateGroups: Record<string, unknown>[] = []
const templateMembers: Record<string, unknown>[] = []
for (let i = 1; i <= 100; i += 1) {
  const templateId = randomUUID()
  templates.push({
    id: templateId,
    name: `Состав ${pick(['осады', 'рейда', 'арены', 'босса'])} #${i}`,
    created_by: pick(staff).id,
    created_at: iso(daysAgo(int(1, 200))),
  })
  const people = sample(clan, int(8, 24))
  const count = Math.ceil(people.length / 6)
  for (let g = 0; g < count; g += 1) {
    const groupId = randomUUID()
    templateGroups.push({
      id: groupId,
      template_id: templateId,
      name: `Группа ${g + 1}`,
      position: g,
    })
    people.slice(g * 6, g * 6 + 6).forEach((user, position) => {
      templateMembers.push({
        template_id: templateId,
        user_id: user.id,
        group_id: groupId,
        position,
        is_leader: position === 0,
      })
    })
  }
}
await insert('group_templates', templates)
await insert('group_template_groups', templateGroups)
await insert('group_template_members', templateMembers)

// ---------- Публикации и барахолка ----------
const PUB_TITLES: Record<string, string[]> = {
  article: ['Как мы взяли замок', 'История клана', 'Интервью с офицером'],
  announcement: [
    'Сбор на осаду',
    'Изменение расписания',
    'Набор в клан открыт',
  ],
  news: ['Итоги недели', 'Обновление игры', 'Новые участники'],
  guide: ['Гайд по классу', 'Как фармить золото', 'Тактика на босса'],
  rules: ['Правила клана', 'Правила рейдов', 'Правила барахолки'],
}
function material(title: string, createdAt: number, published: boolean) {
  const summary = chance(0.6) ? text(1) : null
  const content = doc(title, int(1, 4))
  const derived = deriveFields({ title, summary, content })
  return {
    title,
    summary,
    content,
    search_text: derived.searchText,
    excerpt: derived.excerpt,
    cover_url: derived.coverUrl,
    status: published ? 'published' : 'draft',
    created_at: iso(createdAt),
    updated_at: iso(createdAt + int(0, 5) * DAY),
    published_at: published ? iso(createdAt + HOUR) : null,
  }
}
const publications = Array.from({ length: 120 }, (_, i) => {
  const category = pick(Object.keys(PUB_TITLES))
  const published = chance(0.85)
  return {
    id: randomUUID(),
    category,
    show_author: chance(0.8),
    discussion_enabled: published && chance(0.5),
    author_id: pick(staff).id,
    ...material(
      `${pick(PUB_TITLES[category]!)} — ${i + 1}`,
      daysAgo(int(1, 300)),
      published,
    ),
  }
})
await insert('publications', publications)

const GOODS = [
  'Меч дракона',
  'Кольцо силы',
  'Набор эликсиров',
  'Ездовой волк',
  'Свиток телепорта',
  'Плащ теней',
  'Руны улучшения',
  'Помощь с квестом',
  'Прокачка персонажа',
  'Сундук с ресурсами',
]
const listings = Array.from({ length: 130 }, (_, i) => {
  const published = chance(0.85)
  return {
    id: randomUUID(),
    category: pick(['sale', 'buy', 'trade', 'service', 'free']),
    discussion_enabled: published && chance(0.5),
    author_id: pick(clan).id,
    ...material(`${pick(GOODS)} #${i + 1}`, daysAgo(int(0, 120)), published),
  }
})
await insert('market_listings', listings)

// ---------- Обсуждения ----------
const threads: Record<string, unknown>[] = []
const owners = [
  ...publications
    .filter((p) => p.discussion_enabled)
    .map((p) => ({ publication_id: p.id })),
  ...listings
    .filter((l) => l.discussion_enabled)
    .map((l) => ({ market_listing_id: l.id })),
  ...sample(eventIds, 70).map((id) => ({ event_id: id })),
  ...sample(generalVotes, 50).map((id) => ({ vote_id: id })),
]
for (const owner of owners) {
  threads.push({
    id: randomUUID(),
    event_id: null,
    vote_id: null,
    publication_id: null,
    market_listing_id: null,
    ...owner,
    created_at: iso(daysAgo(int(5, 200))),
  })
}
const messages: Record<string, unknown>[] = []
const reactions: Record<string, unknown>[] = []
const reads: Record<string, unknown>[] = []
const EMOJI = ['❤️', '👍', '👎', '😂', '🔥', '😢', '😭', '😐', '👌', '🤡']
for (const thread of threads) {
  const start = Date.parse(thread.created_at as string)
  const ids: string[] = []
  for (let m = 0; m < int(2, 25); m += 1) {
    const id = randomUUID()
    const at = start + m * int(10, 600) * 60_000
    const edited = chance(0.1) ? at + 5 * 60_000 : null
    messages.push({
      id,
      thread_id: thread.id,
      author_id: pick(clan).id,
      reply_to_id: ids.length && chance(0.25) ? pick(ids) : null,
      body: text(int(1, 3)),
      created_at: iso(at),
      edited_at: edited ? iso(edited) : null,
      changed_at: iso(edited ?? at),
    })
    ids.push(id)
    if (chance(0.35)) {
      for (const user of sample(clan, int(1, 5))) {
        reactions.push({
          message_id: id,
          user_id: user.id,
          emoji: pick(EMOJI),
          created_at: iso(at + HOUR),
        })
      }
    }
  }
  for (const user of sample(clan, int(3, 20))) {
    reads.push({
      thread_id: thread.id,
      user_id: user.id,
      read_up_to: iso(start + int(0, 48) * HOUR),
    })
  }
}
const uniqueReactions = [
  ...new Map(
    reactions.map((r) => [`${r.message_id}|${r.user_id}|${r.emoji}`, r]),
  ).values(),
]
await insert('discussion_threads', threads)
await insert('discussion_messages', messages)
await insert('discussion_reactions', uniqueReactions)
await insert('discussion_reads', reads)

// ---------- Уведомления, просмотры разделов, аудит, рассылки ----------
const NOTIFY: [string, string, string, () => string][] = [
  ['application_accepted', 'Заявка принята', 'account', () => 'me'],
  ['application_rejected', 'Заявка отклонена', 'account', () => 'me'],
  [
    'discussion_mention',
    'Вас упомянули в обсуждении',
    'publication',
    () => pick(publications).id,
  ],
  [
    'discussion_reply',
    'Ответ на ваше сообщение',
    'market_listing',
    () => pick(listings).id,
  ],
  [
    'group_added',
    'Вы добавлены в группу события',
    'event',
    () => pick(eventIds),
  ],
  [
    'group_leader',
    'Вы назначены лидером группы',
    'event',
    () => pick(eventIds),
  ],
  ['role_changed', 'Ваша роль изменена', 'account', () => 'me'],
]
await insert(
  'user_notifications',
  Array.from({ length: 600 }, () => {
    const [kind, title, targetKind, target] = pick(NOTIFY)
    const createdAt = daysAgo(int(0, 60))
    return {
      recipient_id: pick(registered).id,
      actor_id: pick(staff).id,
      kind,
      title,
      body: chance(0.6) ? pick(LOREM) : '',
      target_kind: targetKind,
      target_id: target(),
      source_kind: 'seed',
      source_id: randomUUID(),
      created_at: iso(createdAt),
      read_at: chance(0.5) ? iso(createdAt + HOUR) : null,
    }
  }),
)

await insert(
  'section_views',
  clan.flatMap((user) =>
    sample(
      ['events', 'votes', 'publications', 'market', 'applications', 'accounts'],
      int(1, 6),
    ).map((section) => ({
      user_id: user.id,
      section,
      seen_at: iso(daysAgo(int(0, 14))),
    })),
  ),
)

const AUDIT: [string, string, string][] = [
  ['applications', 'application_accepted_final', 'Заявка принята'],
  ['applications', 'application_rejected', 'Заявка отклонена'],
  [
    'applications',
    'application_submitted_to_vote',
    'Передача заявки на голосование',
  ],
  ['events', 'event_created', 'Создано событие'],
  ['events', 'event_closed', 'Событие закрыто'],
  ['events', 'event_updated', 'Событие изменено'],
  ['votes', 'vote_created', 'Создано голосование'],
  ['votes', 'vote_closed', 'Голосование завершено'],
  ['publications', 'publication_published', 'Публикация опубликована'],
  ['market', 'listing_created', 'Создано объявление'],
  ['participants', 'role_changed', 'Изменена роль участника'],
  ['profiles', 'profile_updated', 'Профиль изменён'],
  ['broadcast', 'broadcast_template_saved', 'Сохранён шаблон рассылки'],
]
const auditRows = Array.from({ length: 400 }, () => {
  const [category, action, summary] = pick(AUDIT)
  const actor = pick(staff)
  const target = pick(users)
  return {
    created_at: iso(daysAgo(rand() * 300)),
    category,
    action,
    summary,
    actor_id: actor.id,
    actor_role: actor.role,
    actor_nickname: actor.nickname,
    actor_email: actor.email,
    target_kind: 'user',
    target_id: target.id,
    target_user_id: target.id,
    target_nickname: target.nickname,
    target_email: target.email,
    details: {},
  }
}).sort((a, b) => a.created_at.localeCompare(b.created_at))
await insert('audit_log', auditRows)

const channelsOf = () => sample(['telegram', 'vk', 'max'], int(1, 3))
await insert(
  'broadcast_templates',
  Array.from({ length: 100 }, (_, i) => ({
    author_id: pick(staff).id,
    name: `Шаблон рассылки ${i + 1}`,
    subject: chance(0.7) ? pick(VOTE_TOPICS) : null,
    body: text(int(1, 4)),
    channels: channelsOf(),
    created_at: iso(daysAgo(int(1, 200))),
  })),
)
await insert(
  'broadcast_drafts',
  Array.from({ length: 110 }, () => {
    const source = chance(0.4) ? pick(['event', 'vote'] as const) : null
    return {
      author_id: pick(staff).id,
      subject: chance(0.7) ? pick(VOTE_TOPICS) : null,
      body: text(int(1, 4)),
      channels: channelsOf(),
      source_kind: source,
      source_id:
        source === 'event'
          ? pick(eventIds)
          : source === 'vote'
            ? pick(generalVotes)
            : null,
      created_at: iso(daysAgo(int(0, 60))),
    }
  }),
)

await sql.end()
console.log(
  'Готово. Вход: seed-admin@example.test, seed-officer-1@example.test, seed-member-1@example.test и т. д.',
)
