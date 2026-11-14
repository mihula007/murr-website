-- Этап 13: Telegram — привязка аккаунта и анонсы с кнопками ответа на
-- событие (TGM, Q-76–Q-96). Правила — в сервисе `telegram`; здесь только
-- структура и ограничения целостности.

-- Связь аккаунта с Telegram (TGM-04, TGM-05, Q-89): один Telegram — один
-- аккаунт. Удаление пользователя удаляет связь.
create table app.telegram_links (
  user_id uuid primary key references app.profiles (id) on delete cascade,
  telegram_user_id bigint not null unique,
  chat_id bigint not null,
  -- Только для показа в кабинете; сопоставление — по telegram_user_id.
  username text check (char_length(username) between 1 and 64),
  display_name text not null check (char_length(display_name) between 1 and 200),
  linked_at timestamptz not null default now(),
  -- Бот заблокирован пользователем (TGM-08): анонсы не отправляются.
  blocked_at timestamptz
);

-- Одноразовый код привязки (TGM-03, Q-89): хранится только SHA-256 (hex),
-- один действующий код на пользователя.
create table app.telegram_link_codes (
  user_id uuid primary key references app.profiles (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);

-- Тема и текст анонса события: нужны, чтобы перерисовать сообщение со
-- строкой ответа и без неё. Отдельные анонсы не хранятся (Q-80).
create table app.telegram_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.events (id) on delete cascade,
  subject text check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3800),
  created_at timestamptz not null default now()
);

create index telegram_announcements_event on app.telegram_announcements (event_id);

-- Активное сообщение участника по событию (TGM-22, Q-78): ровно одно, кнопки
-- принимаются только от него.
create table app.telegram_event_messages (
  event_id uuid not null references app.events (id) on delete cascade,
  user_id uuid not null references app.profiles (id) on delete cascade,
  announcement_id uuid not null
    references app.telegram_announcements (id) on delete cascade,
  chat_id bigint not null,
  message_id bigint not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index telegram_event_messages_user on app.telegram_event_messages (user_id);
create index telegram_event_messages_announcement
  on app.telegram_event_messages (announcement_id);

-- Вложения рассылок отменены (Q-82); текст ограничен лимитом сообщения
-- Telegram (TGM-17, Q-91).
alter table app.broadcast_drafts drop column attachments;
alter table app.broadcast_drafts drop constraint broadcast_drafts_body_check;
alter table app.broadcast_drafts add constraint broadcast_drafts_body_check
  check (char_length(body) between 1 and 3800);
alter table app.broadcast_templates drop constraint broadcast_templates_body_check;
alter table app.broadcast_templates add constraint broadcast_templates_body_check
  check (char_length(body) between 1 and 3800);

alter table app.telegram_links enable row level security;
alter table app.telegram_link_codes enable row level security;
alter table app.telegram_announcements enable row level security;
alter table app.telegram_event_messages enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.telegram_links, app.telegram_link_codes,
  app.telegram_announcements, app.telegram_event_messages
  from public, anon, authenticated, service_role;
