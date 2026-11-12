-- Этап 8: публикации (PUB), вложения публикаций и торговые объявления (MKT).
-- Как и раньше (Q-26), здесь только схема и ограничения целостности;
-- права, проверка документа (Q-57), файлы и аудит — в сервисах Edge Functions.

-- Поиск по подстроке без учёта регистра (PUB-09, MKT-11) — триграммный индекс.
create extension if not exists pg_trgm with schema extensions;

create table app.publications (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in ('article', 'announcement', 'news', 'guide', 'rules')),
  title text not null check (char_length(title) between 1 and 120),
  summary text check (char_length(summary) between 1 and 300),
  -- Документ Tiptap, проверенный zod-схемой в сервисе (Q-57).
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  -- Заголовок, анонс, текст и имена вложений в нижнем регистре; пишет сервис.
  search_text text not null,
  -- Карточка ленты: анонс или начало текста и первое изображение по URL.
  excerpt text not null check (char_length(excerpt) <= 300),
  cover_url text check (char_length(cover_url) <= 2000),
  status text not null check (status in ('draft', 'published')),
  show_author boolean not null default true,
  discussion_enabled boolean not null default false,
  -- Удаление автора: опубликованное остаётся без связи (PUB-17); черновики
  -- процедура удаления обязана удалить заранее — иначе check ниже отклонит.
  author_id uuid references app.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (author_id is not null or status = 'published'),
  check (status = 'draft' or published_at is not null)
);

-- Лента: опубликованные по обновлению (нумерованные страницы, Q-55);
-- черновики: свои (автор) или все (администратор).
create index publications_feed on app.publications (status, updated_at desc, id desc);
create index publications_author on app.publications (author_id, status, updated_at desc);
create index publications_search on app.publications
  using gin (search_text extensions.gin_trgm_ops);

create table app.publication_attachments (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references app.publications (id) on delete cascade,
  -- Путь в приватном bucket `publication-images`.
  path text not null unique check (char_length(path) between 1 and 300),
  file_name text not null check (char_length(file_name) between 1 and 200),
  size integer not null check (size between 1 and 1048576),
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  position smallint not null check (position between 0 and 9),
  unique (publication_id, position) deferrable initially deferred
);

create table app.market_listings (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in ('sale', 'buy', 'trade', 'service', 'free')),
  title text not null check (char_length(title) between 1 and 120),
  summary text check (char_length(summary) between 1 and 300),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  search_text text not null,
  excerpt text not null check (char_length(excerpt) <= 300),
  cover_url text check (char_length(cover_url) <= 2000),
  status text not null check (status in ('draft', 'published')),
  discussion_enabled boolean not null default false,
  -- Удаление автора: объявление остаётся без связи (MKT-12), черновики — нет.
  author_id uuid references app.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (author_id is not null or status = 'published'),
  check (status = 'draft' or published_at is not null)
);

create index market_listings_feed on app.market_listings (status, updated_at desc, id desc);
create index market_listings_author on app.market_listings (author_id, status, updated_at desc);
create index market_listings_search on app.market_listings
  using gin (search_text extensions.gin_trgm_ops);

alter table app.publications enable row level security;
alter table app.publication_attachments enable row level security;
alter table app.market_listings enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.publications, app.publication_attachments, app.market_listings
  from public, anon, authenticated, service_role;
