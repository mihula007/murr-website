-- Этап 4: решения по заявкам и личные уведомления (APP-14, Q-36).
-- Как и на этапе 3 (Q-26), здесь только схема и ограничения целостности;
-- правила переходов, права и аудит — в сервисах Edge Functions.

-- Решённая заявка всегда имеет время решения, активная — нет.
alter table app.join_applications
  add constraint join_applications_decided_at_matches_status check (
    (status in (
      'officer_approved', 'officer_rejected', 'admin_approved', 'admin_rejected'
    )) = (decided_at is not null)
  );

create table app.user_notifications (
  id uuid primary key default gen_random_uuid(),
  -- Уведомление принадлежит получателю и удаляется вместе с ним (Q-33).
  recipient_id uuid not null references app.profiles (id) on delete cascade,
  -- Инициатор — исполнитель: при удалении ссылка очищается (Q-33).
  actor_id uuid references app.profiles (id) on delete set null,
  kind text not null
    check (kind in ('application_accepted', 'application_rejected')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 500),
  -- Навигационная ссылка на объект; доступа к нему не даёт.
  target_kind text check (char_length(target_kind) between 1 and 40),
  target_id text check (char_length(target_id) between 1 and 100),
  -- Источник для защиты от дубликатов при повторе операции.
  source_kind text not null check (char_length(source_kind) between 1 and 40),
  source_id text not null check (char_length(source_id) between 1 and 100),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, source_kind, source_id, kind),
  check ((target_kind is null) = (target_id is null))
);

create index user_notifications_recent
  on app.user_notifications (recipient_id, created_at desc);
create index user_notifications_unread
  on app.user_notifications (recipient_id, created_at desc)
  where read_at is null;
create index user_notifications_actor on app.user_notifications (actor_id);

alter table app.user_notifications enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.user_notifications
  from public, anon, authenticated, service_role;
