begin;

select plan(2);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-000000000018', 'master@example.test', now(), 'authenticated', 'authenticated');

select lives_ok(
  $$insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
    values ('00000000-0000-0000-0000-000000000018', 'Мастер', 'Мастер', 1, 'master')$$,
  'роль master допустима'
);

select throws_ok(
  $$insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
    values ('00000000-0000-0000-0000-000000000019', 'Роль', 'Роль', 1, 'unknown')$$,
  '23514', null, 'неизвестная роль отклоняется'
);

select * from finish();

rollback;
