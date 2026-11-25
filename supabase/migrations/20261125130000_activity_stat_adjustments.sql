-- Ручные поправки к общим показателям активности; история закрытых событий не меняется.
create table app.activity_stat_adjustments (
  user_id uuid primary key references app.profiles (id) on delete cascade,
  visited_delta integer not null default 0,
  missed_delta integer not null default 0,
  unmarked_delta integer not null default 0,
  leader_count_delta integer not null default 0,
  days_in_guild_delta integer not null default 0,
  days_in_guild_set_on date
);

alter table app.activity_stat_adjustments enable row level security;
revoke all on app.activity_stat_adjustments
  from public, anon, authenticated, service_role;

alter table app.officer_permissions
  drop constraint officer_permissions_permission_code_check;

alter table app.officer_permissions
  add constraint officer_permissions_permission_code_check check (
    permission_code in (
      'applications.review',
      'applications.submit_vote',
      'applications.decide_after_vote',
      'applications.decide_direct',
      'broadcasts.send',
      'broadcasts.templates',
      'broadcasts.subscriptions',
      'events.manage',
      'events.view_full_roster',
      'events.templates',
      'events.delete_own',
      'groups.manage',
      'groups.templates',
      'events.close',
      'votes.manage',
      'votes.complete_delete',
      'votes.view_ballots',
      'roster.reader_roles',
      'activity.view_export',
      'activity.correct_rating',
      'activity.correct_summary',
      'publications.manage_own'
    )
  );
