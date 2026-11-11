-- Этап 5: голосования (VOT) и связанный приём (APP-05, 07, 08, 11).
-- Как и раньше (Q-26), здесь только схема и ограничения целостности;
-- правила, права, переходы заявки и аудит — в сервисах Edge Functions.

create table app.votes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('general', 'application')),
  title text not null check (char_length(title) between 1 and 120),
  context text not null default '' check (char_length(context) <= 1000),
  -- Создатель и завершивший — исполнители: при удалении ссылка очищается,
  -- голосование сохраняется (VOT-15, Q-33).
  created_by uuid references app.profiles (id) on delete set null,
  -- Голосование по заявке удаляется вместе с заявкой (APP-15).
  application_id uuid references app.join_applications (id) on delete cascade,
  closed_at timestamptz,
  closed_by uuid references app.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Тип и связь с заявкой не расходятся (VOT-04).
  check ((kind = 'application') = (application_id is not null)),
  -- Завершивший есть только у завершённого голосования.
  check (closed_by is null or closed_at is not null)
);

-- Одно активное голосование на заявку (APP-05).
create unique index votes_one_active_per_application
  on app.votes (application_id)
  where application_id is not null and closed_at is null;
-- Активные: новые сверху; история: keyset (closed_at desc, id desc).
create index votes_active on app.votes (created_at desc, id desc)
  where closed_at is null;
create index votes_history on app.votes (closed_at desc, id desc)
  where closed_at is not null;
create index votes_created_by on app.votes (created_by);
create index votes_closed_by on app.votes (closed_by);

create table app.vote_options (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references app.votes (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  -- trim + нижний регистр: варианты различаются без учёта регистра (VOT-03).
  normalized_label text not null
    check (char_length(normalized_label) between 1 and 80),
  position smallint not null check (position between 0 and 9),
  unique (vote_id, position),
  unique (vote_id, normalized_label),
  -- Цель составного FK голоса: вариант именно этого голосования.
  unique (vote_id, id)
);

create table app.vote_ballots (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references app.votes (id) on delete cascade,
  option_id uuid not null,
  -- При удалении пользователя голос сохраняется обезличенно (VOT-16).
  voter_id uuid references app.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (vote_id, option_id)
    references app.vote_options (vote_id, id) on delete cascade
);

-- Одно текущее решение участника на голосование (VOT-05).
create unique index vote_ballots_one_per_voter
  on app.vote_ballots (vote_id, voter_id)
  where voter_id is not null;
create index vote_ballots_totals on app.vote_ballots (vote_id, option_id);
create index vote_ballots_voter on app.vote_ballots (voter_id);

alter table app.votes enable row level security;
alter table app.vote_options enable row level security;
alter table app.vote_ballots enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.votes, app.vote_options, app.vote_ballots
  from public, anon, authenticated, service_role;
