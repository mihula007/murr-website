-- Этап 15: ВКонтакте — привязка аккаунта и анонсы с кнопками ответа на событие
-- (VK-01–VK-09, Q-100). Устройство повторяет таблицы Telegram
-- (этап 13); правила — в сервисе `vk`.

-- Связь аккаунта с ВКонтакте (VK-01, VK-02): один ВКонтакте — один аккаунт, независимо
-- от Telegram и MAX. Удаление пользователя удаляет связь.
create table app.vk_links (
  user_id uuid primary key references app.profiles (id) on delete cascade,
  vk_user_id bigint not null unique,
  chat_id bigint not null,
  -- Только для показа в кабинете; сопоставление — по vk_user_id.
  username text check (char_length(username) between 1 and 64),
  display_name text not null check (char_length(display_name) between 1 and 200),
  linked_at timestamptz not null default now(),
  -- Сообщения от сообщества запрещены (VK-03): анонсы не отправляются.
  blocked_at timestamptz
);

-- Одноразовый код привязки: только SHA-256 (hex), один на пользователя.
create table app.vk_link_codes (
  user_id uuid primary key references app.profiles (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);

-- Тема и текст анонса события для перерисовки сообщения (VK-07).
create table app.vk_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references app.events (id) on delete cascade,
  subject text check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3800),
  created_at timestamptz not null default now()
);

create index vk_announcements_event on app.vk_announcements (event_id);

-- Активное сообщение участника по событию во ВКонтакте: ровно одно.
-- `chat_id` — `peer_id` диалога, `message_id` — `conversation_message_id`.
create table app.vk_event_messages (
  event_id uuid not null references app.events (id) on delete cascade,
  user_id uuid not null references app.profiles (id) on delete cascade,
  announcement_id uuid not null
    references app.vk_announcements (id) on delete cascade,
  chat_id bigint not null,
  message_id bigint not null check (message_id > 0),
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index vk_event_messages_user on app.vk_event_messages (user_id);
create index vk_event_messages_announcement
  on app.vk_event_messages (announcement_id);

alter table app.vk_links enable row level security;
alter table app.vk_link_codes enable row level security;
alter table app.vk_announcements enable row level security;
alter table app.vk_event_messages enable row level security;

revoke all on app.vk_links, app.vk_link_codes,
  app.vk_announcements, app.vk_event_messages
  from public, anon, authenticated, service_role;
