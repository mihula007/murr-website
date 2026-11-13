-- Этап 3: аккаунт, заявка и аудит.
-- По решению владельца (Q-26) здесь только схема и ограничения целостности:
-- функций, триггеров и RLS-политик с правилами нет. Таблицы лежат в схеме app,
-- которая не открыта Data API; доступ — только из Edge Functions прямым
-- подключением. RLS включён без политик как запрет по умолчанию.

create schema app;

revoke all on schema app from public, anon, authenticated, service_role;

create table app.character_classes (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z][a-z-]*$'),
  name text not null unique check (char_length(name) between 1 and 40),
  sort_order smallint not null,
  is_active boolean not null default true
);

-- Справочник ROS-09 в порядке и написании прототипа.
insert into app.character_classes (slug, name, sort_order) values
  ('werewolf', 'Оборотень', 1),
  ('druid', 'Друид', 2),
  ('wanderer', 'Странник', 3),
  ('priest', 'Жрец', 4),
  ('archer', 'Лучник', 5),
  ('paladin', 'Паладин', 6),
  ('mage', 'Маг', 7),
  ('warrior', 'Воин', 8),
  ('gunner', 'Стрелок', 9),
  ('assassin', 'Убийца', 10),
  ('shaman', 'Шаман', 11),
  ('bard', 'Бард', 12),
  ('mystic', 'Мистик', 13),
  ('guardian', 'Страж', 14),
  ('blood-spirit', 'Дух Крови', 15),
  ('ghost', 'Призрак', 16),
  ('reaper', 'Жнец', 17);

create table app.profiles (
  -- RESTRICT: пользователя Auth нельзя удалить, пока есть профиль (Q-33).
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 12),
  -- С учётом регистра, до 9 символов (Q-27).
  game_nickname text not null unique
    check (char_length(game_nickname) between 1 and 9),
  city text check (char_length(city) <= 100),
  birth_date date,
  class_id smallint not null references app.character_classes (id),
  about text check (char_length(about) <= 1200),
  avatar_path text check (char_length(avatar_path) <= 200),
  access_role text not null
    check (access_role in ('applicant', 'reader', 'member', 'officer', 'admin')),
  is_primary_admin boolean not null default false,
  joined_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_primary_admin or access_role = 'admin')
);

create unique index profiles_single_primary_admin
  on app.profiles (is_primary_admin) where is_primary_admin;
create index profiles_access_role on app.profiles (access_role);
create index profiles_class_role on app.profiles (class_id, access_role);

create table app.join_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references app.profiles (id) on delete cascade,
  status text not null check (status in (
    'pending_officer_review', 'pending_vote', 'vote_completed',
    'officer_approved', 'officer_rejected', 'admin_approved', 'admin_rejected'
  )),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  -- Исполнитель решения: при удалении пользователя ссылка очищается (Q-33).
  decided_by uuid references app.profiles (id) on delete set null,
  decision_note text check (char_length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Не более одной активной заявки (Q-06); защищает от двух вкладок.
create unique index join_applications_one_active
  on app.join_applications (applicant_id)
  where status in ('pending_officer_review', 'pending_vote', 'vote_completed');
create index join_applications_queue
  on app.join_applications (status, submitted_at desc);
create index join_applications_history
  on app.join_applications (applicant_id, created_at desc);

create table app.application_equipment_links (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references app.join_applications (id) on delete cascade,
  url text not null check (char_length(url) between 1 and 500),
  position smallint not null check (position between 0 and 9),
  created_at timestamptz not null default now(),
  unique (application_id, position)
);

create table app.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  category text not null check (char_length(category) between 1 and 40),
  action text not null check (char_length(action) between 1 and 80),
  summary text not null check (char_length(summary) between 1 and 300),
  actor_id uuid references app.profiles (id) on delete set null,
  actor_role text,
  actor_nickname text,
  actor_email text,
  target_kind text,
  target_id text,
  target_user_id uuid references app.profiles (id) on delete set null,
  target_nickname text,
  target_email text,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object')
);

create index audit_log_recent on app.audit_log (created_at desc, id desc);
create index audit_log_category on app.audit_log (category, created_at desc, id desc);
create index audit_log_actor on app.audit_log (actor_id, created_at desc);
create index audit_log_target on app.audit_log (target_kind, target_id, created_at desc);

alter table app.character_classes enable row level security;
alter table app.profiles enable row level security;
alter table app.join_applications enable row level security;
alter table app.application_equipment_links enable row level security;
alter table app.audit_log enable row level security;

revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all sequences in schema app from public, anon, authenticated, service_role;

-- Будущие таблицы схемы тоже не получают прав браузерных ролей автоматически.
alter default privileges in schema app
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema app
  revoke all on sequences from public, anon, authenticated, service_role;
