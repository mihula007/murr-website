-- Этап 6: события (EVT), ответы участников и шаблоны событий.
-- Как и раньше (Q-26), здесь только схема и ограничения целостности;
-- правила, права, время «до начала» и аудит — в сервисах Edge Functions.

create table app.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  event_type text not null check (event_type in ('pvp', 'pve', 'clan')),
  description text not null check (char_length(description) between 1 and 2000),
  -- Момент начала в UTC; вводится и показывается по МСК (Q-08, Q-44).
  starts_at timestamptz not null,
  -- Выпуск постоянного события (EVT-14, Q-42) или null для обычного.
  recurring_preset text
    check (recurring_preset in ('mtv_sat_20', 'sadik_sat_22', 'tv_sun_20', 'tv_sun_22')),
  -- Автор — исполнитель: при удалении ссылка очищается, событие сохраняется
  -- (EVT-16). У постоянных выпусков автора нет (Q-47).
  created_by uuid references app.profiles (id) on delete set null,
  -- Закрытие — этап 7.
  closed_at timestamptz,
  closed_by uuid references app.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closed_by is null or closed_at is not null),
  -- Один выпуск пресета на одно время: защита от дубликата и от гонки
  -- расписания с запасной кнопкой (EVT-14).
  unique (recurring_preset, starts_at)
);

-- Актуальные: по времени начала; прошедшие: keyset (closed_at desc, id desc).
create index events_active on app.events (starts_at, id) where closed_at is null;
create index events_past on app.events (closed_at desc, id desc)
  where closed_at is not null;
create index events_created_by on app.events (created_by);
create index events_closed_by on app.events (closed_by);

create table app.event_attendance (
  event_id uuid not null references app.events (id) on delete cascade,
  -- Посещаемость удалённого пользователя удаляется (ACT-17).
  user_id uuid not null references app.profiles (id) on delete cascade,
  answer text not null check (answer in ('yes', 'no', 'maybe')),
  answered_at timestamptz not null default now(),
  -- Один ответ участника на событие (EVT-05).
  primary key (event_id, user_id)
);

create index event_attendance_answers on app.event_attendance (event_id, answer);
create index event_attendance_user on app.event_attendance (user_id);

create table app.event_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  event_type text not null check (event_type in ('pvp', 'pve', 'clan')),
  description text not null check (char_length(description) between 1 and 2000),
  -- День недели и время по МСК: 0 — воскресенье (EVT-11).
  weekday smallint not null check (weekday between 0 and 6),
  time_msk time not null,
  -- Шаблоны удалённого пользователя удаляются (ADM-08).
  created_by uuid not null references app.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index event_templates_recent on app.event_templates (created_at desc, id desc);
create index event_templates_created_by on app.event_templates (created_by);

alter table app.events enable row level security;
alter table app.event_attendance enable row level security;
alter table app.event_templates enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.events, app.event_attendance, app.event_templates
  from public, anon, authenticated, service_role;

-- Автоматический выпуск постоянных событий (Q-42): каждый понедельник
-- в 00:00 МСК (воскресенье 21:00 UTC; pg_cron работает в UTC). Задание только
-- вызывает функцию `api`; правила выпуска — в TypeScript. Адрес функции и
-- секрет хранятся в Supabase Vault (`events_cron_api_url`,
-- `events_cron_secret`) и в миграцию не попадают; без них запрос не делается.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'events-ensure-weekly',
  '0 21 * * 0',
  $job$
  select net.http_post(
    url := s.api_url || '/functions/v1/api/events/ensure-weekly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', s.secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from (
    select
      (select decrypted_secret from vault.decrypted_secrets
        where name = 'events_cron_api_url') as api_url,
      (select decrypted_secret from vault.decrypted_secrets
        where name = 'events_cron_secret') as secret
  ) as s
  where s.api_url is not null and s.secret is not null
  $job$
);

-- История выполнения заданий не растёт бесконечно.
select cron.schedule(
  'cron-history-cleanup',
  '30 21 * * 0',
  $job$
  delete from cron.job_run_details where end_time < now() - interval '30 days'
  $job$
);
