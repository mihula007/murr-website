begin;

select plan(5);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000020', 'officer-permissions-1@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000021', 'officer-permissions-2@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000020', 'Офицер', 'Права1', 1, 'officer'),
  ('00000000-0000-0000-0000-000000000021', 'Офицер', 'Права2', 1, 'officer');

select ok(
  not has_table_privilege('authenticated', 'app.officer_permissions', 'select'),
  'authenticated не читает таблицу прав напрямую'
);

select ok(
  not has_table_privilege('anon', 'app.officer_permissions', 'select'),
  'anon не читает таблицу прав напрямую'
);

select is(
  (select count(*)::integer from app.officer_permissions
    where officer_id = '00000000-0000-0000-0000-000000000020'),
  0,
  'у нового офицера нет включённых прав'
);

select lives_ok(
  $$insert into app.officer_permissions (officer_id, permission_code)
    values ('00000000-0000-0000-0000-000000000020', 'events.view_full_roster')$$,
  'разрешённый код права сохраняется'
);

select throws_ok(
  $$insert into app.officer_permissions (officer_id, permission_code)
    values ('00000000-0000-0000-0000-000000000021', 'events.unknown')$$,
  '23514', null, 'неизвестный код права отклоняется'
);

select * from finish();

rollback;
