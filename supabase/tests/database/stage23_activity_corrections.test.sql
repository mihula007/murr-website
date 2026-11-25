begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select ok(
  exists (
    select 1 from pg_tables
    where schemaname = 'app'
      and tablename = 'activity_stat_adjustments'
      and rowsecurity
  ),
  'таблица корректировок существует и защищена RLS'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as roles(role_name)
    where has_table_privilege(role_name, 'app.activity_stat_adjustments',
      'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прямого доступа к корректировкам'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000230', 'activity-correction@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values ('00000000-0000-0000-0000-000000000230', 'Проверка', 'Correct23', 1, 'member');

select lives_ok(
  $$insert into app.activity_stat_adjustments (user_id, visited_delta, leader_count_delta, days_in_guild_delta)
    values ('00000000-0000-0000-0000-000000000230', 2, -1, 10)$$,
  'дельты сохраняются отдельной строкой пользователя'
);

select is(
  (select count(*)::integer from app.activity_stat_adjustments
    where user_id = '00000000-0000-0000-0000-000000000230'),
  1,
  'на пользователя приходится одна строка корректировок'
);

delete from app.profiles where id = '00000000-0000-0000-0000-000000000230';
select is(
  (select count(*)::integer from app.activity_stat_adjustments
    where user_id = '00000000-0000-0000-0000-000000000230'),
  0,
  'корректировки удалённого профиля удаляются каскадно'
);

select * from finish();

rollback;
