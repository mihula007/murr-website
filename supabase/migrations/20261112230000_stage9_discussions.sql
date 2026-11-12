-- Этап 9: обсуждения (DSC) у событий, голосований, публикаций и объявлений.
-- Как и раньше (Q-26), здесь только схема и ограничения целостности;
-- права, окно правки, упоминания и уведомления — в сервисе Edge Function.

-- Ветка — одна строка на родителя; удаление родителя очищает ветку (DSC-14).
create table app.discussion_threads (
  id uuid primary key default gen_random_uuid(),
  event_id uuid unique references app.events (id) on delete cascade,
  vote_id uuid unique references app.votes (id) on delete cascade,
  publication_id uuid unique references app.publications (id) on delete cascade,
  market_listing_id uuid unique references app.market_listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(event_id, vote_id, publication_id, market_listing_id) = 1)
);

create table app.discussion_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references app.discussion_threads (id) on delete cascade,
  -- Удаление автора: сообщение остаётся без связи (DSC-16).
  author_id uuid references app.profiles (id) on delete set null,
  -- Ответ — сообщение той же ветки (проверяет сервис).
  reply_to_id uuid references app.discussion_messages (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Создание, правка или изменение реакций — для опроса изменений (Q-58).
  changed_at timestamptz not null default now(),
  check (edited_at is null or edited_at >= created_at),
  check (changed_at >= created_at)
);

-- Страницы ветки: keyset (created_at desc, id desc); изменения — по changed_at.
create index discussion_messages_page
  on app.discussion_messages (thread_id, created_at desc, id desc);
create index discussion_messages_changes
  on app.discussion_messages (thread_id, changed_at);
create index discussion_messages_author on app.discussion_messages (author_id);
create index discussion_messages_reply on app.discussion_messages (reply_to_id);

create table app.discussion_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references app.discussion_messages (id) on delete cascade,
  -- Удаление пользователя: реакция остаётся обезличенной (DSC-17, Q-33).
  user_id uuid references app.profiles (id) on delete set null,
  emoji text not null
    check (emoji in ('❤️', '👍', '👎', '😂', '🔥', '😢', '😭', '😐', '👌', '🤡')),
  created_at timestamptz not null default now(),
  -- По одной реакции каждого вида от аккаунта (DSC-11).
  unique (message_id, user_id, emoji)
);

create index discussion_reactions_user on app.discussion_reactions (user_id);

-- Отметка «прочитано до» на ветку; удаляется вместе с пользователем (DSC-17).
create table app.discussion_reads (
  thread_id uuid not null references app.discussion_threads (id) on delete cascade,
  user_id uuid not null references app.profiles (id) on delete cascade,
  read_up_to timestamptz not null,
  primary key (thread_id, user_id)
);

create index discussion_reads_user on app.discussion_reads (user_id);

-- Уведомления об упоминании и ответе (DSC-07).
alter table app.user_notifications
  drop constraint user_notifications_kind_check;
alter table app.user_notifications
  add constraint user_notifications_kind_check check (kind in (
    'application_accepted', 'application_rejected',
    'discussion_mention', 'discussion_reply'
  ));

alter table app.discussion_threads enable row level security;
alter table app.discussion_messages enable row level security;
alter table app.discussion_reactions enable row level security;
alter table app.discussion_reads enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.discussion_threads, app.discussion_messages,
  app.discussion_reactions, app.discussion_reads
  from public, anon, authenticated, service_role;
