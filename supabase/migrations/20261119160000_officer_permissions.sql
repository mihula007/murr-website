-- Индивидуальные полномочия офицеров: отсутствующая строка означает «выключено».
create table app.officer_permissions (
  officer_id uuid not null references app.profiles (id) on delete cascade,
  permission_code text not null check (permission_code in (
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
    'publications.manage_own'
  )),
  primary key (officer_id, permission_code)
);

alter table app.officer_permissions enable row level security;
revoke all on app.officer_permissions
  from public, anon, authenticated, service_role;
