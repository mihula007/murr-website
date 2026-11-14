-- Этап 15: MAX — привязка аккаунта и анонсы с кнопками ответа на событие
-- (MAX-01–MAX-12, Q-99–Q-101). Устройство повторяет таблицы Telegram
-- (этап 13); правила — в сервисе `max`.

-- Связь аккаунта с MAX (MAX-01, MAX-02): один MAX — один аккаунт, независимо
-- от Telegram. Удаление пользователя удаляет связь.
create table app.max_links (
  user_id uuid primary key references app.profiles (id) on delete cascade,
  max_user_id bigint not null unique,
  chat_id bigint not null,
  -- Только для показа в кабинете; сопоставление — по max_user_id.
  username text check (char_length(username) between 1 and 64),
  display_name text not null check (char_length(display_name) between 1 and 200),
  linked_at timestamptz not null default now(),
  -- Бот остановлен пользователем (MAX-03): анонсы не отправляются.
  blocked_at timestamptz
);

-- Одноразовый код привязки: только SHA-256 (hex), один на пользователя.
create table app.max_link_codes (
  user_id uuid primary key references app.profiles (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);

-- Тема и текст анонса события для перерисовки сообщения (MAX-07).
create table app.max_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.events (id) on delete cascade,
  subject text check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3800),
  created_at timestamptz not null default now()
);

create index max_announcements_event on app.max_announcements (event_id);

-- Активное сообщение участника по событию в MAX (MAX-07): ровно одно.
-- `message_id` — строковый `mid` MAX.
create table app.max_event_messages (
  event_id uuid not null references app.events (id) on delete cascade,
  user_id uuid not null references app.profiles (id) on delete cascade,
  announcement_id uuid not null
    references app.max_announcements (id) on delete cascade,
  chat_id bigint not null,
  message_id text not null check (char_length(message_id) between 1 and 200),
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index max_event_messages_user on app.max_event_messages (user_id);
create index max_event_messages_announcement
  on app.max_event_messages (announcement_id);

alter table app.max_links enable row level security;
alter table app.max_link_codes enable row level security;
alter table app.max_announcements enable row level security;
alter table app.max_event_messages enable row level security;

revoke all on app.max_links, app.max_link_codes,
  app.max_announcements, app.max_event_messages
  from public, anon, authenticated, service_role;
