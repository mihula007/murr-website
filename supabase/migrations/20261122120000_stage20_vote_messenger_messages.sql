-- Активные сообщения рассылок голосований в трёх мессенджерах.
-- Для каждого канала хранится только последняя рассылка по голосованию;
-- новая рассылка заменяет её вместе с прежними кнопками.

create table app.telegram_vote_announcements (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null unique references app.votes (id) on delete cascade,
  subject text check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3800),
  created_at timestamptz not null default now(),
  unique (id, vote_id)
);

create table app.telegram_vote_messages (
  vote_id uuid not null references app.votes (id) on delete cascade,
  user_id uuid not null references app.profiles (id) on delete cascade,
  announcement_id uuid not null,
  chat_id bigint not null,
  message_id bigint not null,
  media text check (char_length(media) between 1 and 500),
  sent_at timestamptz not null default now(),
  primary key (vote_id, user_id),
  foreign key (announcement_id, vote_id)
    references app.telegram_vote_announcements (id, vote_id) on delete cascade,
  unique (chat_id, message_id)
);

create index telegram_vote_messages_user on app.telegram_vote_messages (user_id);
create index telegram_vote_messages_announcement
  on app.telegram_vote_messages (announcement_id);

create table app.max_vote_announcements (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null unique references app.votes (id) on delete cascade,
  subject text check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3800),
  created_at timestamptz not null default now(),
  unique (id, vote_id)
);

create table app.max_vote_messages (
  vote_id uuid not null references app.votes (id) on delete cascade,
  user_id uuid not null references app.profiles (id) on delete cascade,
  announcement_id uuid not null,
  chat_id bigint not null,
  message_id text not null check (char_length(message_id) between 1 and 200),
  media text check (char_length(media) between 1 and 500),
  sent_at timestamptz not null default now(),
  primary key (vote_id, user_id),
  foreign key (announcement_id, vote_id)
    references app.max_vote_announcements (id, vote_id) on delete cascade,
  unique (chat_id, message_id)
);

create index max_vote_messages_user on app.max_vote_messages (user_id);
create index max_vote_messages_announcement
  on app.max_vote_messages (announcement_id);

create table app.vk_vote_announcements (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null unique references app.votes (id) on delete cascade,
  subject text check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3800),
  created_at timestamptz not null default now(),
  unique (id, vote_id)
);

create table app.vk_vote_messages (
  vote_id uuid not null references app.votes (id) on delete cascade,
  user_id uuid not null references app.profiles (id) on delete cascade,
  announcement_id uuid not null,
  chat_id bigint not null,
  message_id bigint not null check (message_id > 0),
  media text check (char_length(media) between 1 and 500),
  sent_at timestamptz not null default now(),
  primary key (vote_id, user_id),
  foreign key (announcement_id, vote_id)
    references app.vk_vote_announcements (id, vote_id) on delete cascade,
  unique (chat_id, message_id)
);

create index vk_vote_messages_user on app.vk_vote_messages (user_id);
create index vk_vote_messages_announcement
  on app.vk_vote_messages (announcement_id);

alter table app.telegram_vote_announcements enable row level security;
alter table app.telegram_vote_messages enable row level security;
alter table app.max_vote_announcements enable row level security;
alter table app.max_vote_messages enable row level security;
alter table app.vk_vote_announcements enable row level security;
alter table app.vk_vote_messages enable row level security;

revoke all on app.telegram_vote_announcements, app.telegram_vote_messages,
  app.max_vote_announcements, app.max_vote_messages,
  app.vk_vote_announcements, app.vk_vote_messages
  from public, anon, authenticated, service_role;
