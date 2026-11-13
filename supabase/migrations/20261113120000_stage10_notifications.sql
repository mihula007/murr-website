-- Этап 10: новые виды личных уведомлений и отметки просмотра разделов.

-- Группы, пати-лидер и смена роли (NTF-03; ответы на событие исключены, Q-65).
alter table app.user_notifications
  drop constraint user_notifications_kind_check;
alter table app.user_notifications
  add constraint user_notifications_kind_check check (kind in (
    'application_accepted', 'application_rejected',
    'discussion_mention', 'discussion_reply',
    'group_added', 'group_leader', 'role_changed'
  ));

-- Последний просмотр раздела пользователем (NTF-09–12, Q-67).
create table app.section_views (
  -- Отметки личные и удаляются вместе с пользователем (NTF-13).
  user_id uuid not null references app.profiles (id) on delete cascade,
  section text not null check (section in (
    'events', 'votes', 'publications', 'market', 'applications', 'accounts'
  )),
  seen_at timestamptz not null,
  primary key (user_id, section)
);

-- Счёт новизны: объекты после отметки просмотра.
create index events_created on app.events (created_at);
create index votes_created on app.votes (created_at);
create index publications_published on app.publications (published_at)
  where status = 'published';
create index market_listings_published on app.market_listings (published_at)
  where status = 'published';
create index join_applications_submitted on app.join_applications (submitted_at);
create index profiles_created on app.profiles (created_at);

alter table app.section_views enable row level security;

-- Default privileges этапа 3 уже закрывают новые таблицы; повтор — страховка.
revoke all on app.section_views
  from public, anon, authenticated, service_role;
