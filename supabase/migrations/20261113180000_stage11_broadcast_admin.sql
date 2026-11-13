-- Этап 11: черновики и шаблоны рассылок, служебная запись удаления
-- пользователя, индексы сортировки аккаунтов.

-- Черновик рассылки: только подготовка, ничего не отправляется (Q-22, BRC-13).
-- Общий для офицеров и администраторов (Q-70), хранится не больше 50 (Q-69).
create table app.broadcast_drafts (
  id uuid primary key default gen_random_uuid(),
  -- Черновики удалённого пользователя удаляются (решение по удалению).
  author_id uuid not null references app.profiles (id) on delete cascade,
  subject text check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  channels text[] not null check (
    cardinality(channels) between 1 and 3
    and channels <@ array['telegram', 'vk', 'max']::text[]
  ),
  -- Только метаданные файлов: [{ name, size, type }] (BRC-09).
  attachments jsonb not null default '[]'::jsonb check (
    jsonb_typeof(attachments) = 'array'
    and jsonb_array_length(attachments) <= 10
  ),
  source_kind text check (source_kind in ('event', 'vote', 'group')),
  source_id uuid,
  created_at timestamptz not null default now(),
  check ((source_kind is null) = (source_id is null))
);

create index broadcast_drafts_recent
  on app.broadcast_drafts (created_at desc, id desc);
create index broadcast_drafts_author on app.broadcast_drafts (author_id);

-- Шаблон рассылки: тема, текст, каналы; без вложений (BRC-10), не больше 20.
create table app.broadcast_templates (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references app.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  subject text check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 4000),
  channels text[] not null check (
    cardinality(channels) between 1 and 3
    and channels <@ array['telegram', 'vk', 'max']::text[]
  ),
  created_at timestamptz not null default now()
);

create unique index broadcast_templates_name
  on app.broadcast_templates (lower(name));
create index broadcast_templates_author on app.broadcast_templates (author_id);

-- Незавершённое удаление пользователя (Q-74, Q-75). Без FK на профиль:
-- запись переживает транзакцию, удаляющую профиль, и стирается после Auth.
create table app.user_deletions (
  user_id uuid primary key,
  requested_by uuid references app.profiles (id) on delete set null,
  nickname text not null check (char_length(nickname) between 1 and 40),
  email text not null check (char_length(email) between 1 and 320),
  stage text not null check (stage in ('files', 'database', 'auth')),
  -- Файлы удалённых черновиков публикаций: удаляются после транзакции БД.
  cleanup_paths text[] not null default '{}'::text[],
  last_error text check (char_length(last_error) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Сортировки списка аккаунтов (ADM-02) с курсором `(значение, id)`.
create index profiles_display_name on app.profiles (display_name, id);
create index profiles_created_id on app.profiles (created_at, id);
create index profiles_joined_on on app.profiles (joined_on, id);

alter table app.broadcast_drafts enable row level security;
alter table app.broadcast_templates enable row level security;
alter table app.user_deletions enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.broadcast_drafts, app.broadcast_templates, app.user_deletions
  from public, anon, authenticated, service_role;
