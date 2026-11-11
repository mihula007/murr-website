-- Этап 7: группы (пати) события, шаблоны групп и итог посещения закрытого
-- события (GRP, EVT-08, ACT). Как и раньше (Q-26), здесь только схема и
-- ограничения целостности; права, «закрытое не меняется», применение
-- шаблона и аудит — в сервисах Edge Functions.

create table app.event_groups (
  id uuid primary key default gen_random_uuid(),
  -- Удаление события удаляет группы (EVT-10).
  event_id uuid not null references app.events (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  -- Цель составного FK участника: группа того же события.
  unique (id, event_id)
);

create index event_groups_event on app.event_groups (event_id, created_at, id);

create table app.event_group_members (
  event_id uuid not null,
  -- Назначения удалённого пользователя удаляются (GRP-18).
  user_id uuid not null references app.profiles (id) on delete cascade,
  group_id uuid not null,
  -- Порядок внутри группы (GRP-07); сервис пересчитывает позиции в одной
  -- транзакции, поэтому уникальность проверяется в конце транзакции.
  position integer not null check (position >= 0),
  -- Лидер — признак строки участника: перенос или удаление человека не
  -- оставляет ссылку на лидера вне группы (GRP-08, GRP-18).
  is_leader boolean not null default false,
  -- Один участник — одна группа события (GRP-06).
  primary key (event_id, user_id),
  -- Удаление группы возвращает людей в пул (GRP-09).
  foreign key (group_id, event_id)
    references app.event_groups (id, event_id) on delete cascade,
  constraint event_group_members_position unique (group_id, position)
    deferrable initially deferred
);

create unique index event_group_members_one_leader
  on app.event_group_members (group_id) where is_leader;
create index event_group_members_user on app.event_group_members (user_id);

create table app.group_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  -- Шаблоны удалённого пользователя удаляются (Q-33).
  created_by uuid not null references app.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index group_templates_recent on app.group_templates (created_at desc, id desc);
create index group_templates_created_by on app.group_templates (created_by);

create table app.group_template_groups (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references app.group_templates (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  position integer not null check (position >= 0),
  unique (template_id, position),
  unique (id, template_id)
);

create table app.group_template_members (
  template_id uuid not null,
  -- Участник шаблона удаляется вместе с пользователем; лидер — признак
  -- строки, поэтому ссылки на удалённого лидера не остаётся (Q-33).
  user_id uuid not null references app.profiles (id) on delete cascade,
  group_id uuid not null,
  position integer not null check (position >= 0),
  is_leader boolean not null default false,
  -- Один участник — одна группа шаблона.
  primary key (template_id, user_id),
  foreign key (group_id, template_id)
    references app.group_template_groups (id, template_id) on delete cascade,
  unique (group_id, position)
);

create unique index group_template_members_one_leader
  on app.group_template_members (group_id) where is_leader;
create index group_template_members_user on app.group_template_members (user_id);

-- Итог закрытого события (ACT-01–03): строка на каждого участника с копией
-- ника и класса на момент закрытия. Событие и его группы после закрытия
-- неизменяемы (EVT-09, Q-19), поэтому отдельные копии события и групп не
-- нужны.
create table app.event_activity_records (
  -- Архив штатно не удаляется (EVT-10): удаление закрытого события с
  -- итогом отклоняется.
  event_id uuid not null references app.events (id) on delete restrict,
  -- Итог удалённого пользователя удаляется полностью (ACT-17).
  user_id uuid not null references app.profiles (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 40),
  class_id smallint not null references app.character_classes (id),
  status text not null check (status in ('visited', 'missed', 'unmarked')),
  -- Группа и лидерство есть только у посетивших (таблица 11-activity).
  group_name text,
  is_leader boolean not null default false,
  -- Одна запись участника на событие: повторное закрытие не начисляет
  -- посещение второй раз (EVT-08).
  primary key (event_id, user_id),
  check ((status = 'visited') = (group_name is not null)),
  check (not is_leader or status = 'visited')
);

create index event_activity_records_user on app.event_activity_records (user_id, event_id);

-- История и выбор закрытых событий по дате начала (Q-50), новые сверху.
create index events_closed_by_start on app.events (starts_at desc, id desc)
  where closed_at is not null;

alter table app.event_groups enable row level security;
alter table app.event_group_members enable row level security;
alter table app.group_templates enable row level security;
alter table app.group_template_groups enable row level security;
alter table app.group_template_members enable row level security;
alter table app.event_activity_records enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.event_groups, app.event_group_members, app.group_templates,
  app.group_template_groups, app.group_template_members,
  app.event_activity_records
  from public, anon, authenticated, service_role;
