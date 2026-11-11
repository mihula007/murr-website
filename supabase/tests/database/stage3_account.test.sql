-- Схема этапа 3: закрытость для Data API и ограничения целостности.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Браузерные роли не имеют доступа к схеме и таблицам app.
select ok(
  not has_schema_privilege('anon', 'app', 'usage')
    and not has_schema_privilege('authenticated', 'app', 'usage'),
  'anon и authenticated не имеют USAGE на схему app'
);

select is(
  (select count(*)::int from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'))),
  0,
  'ни одна таблица app не доступна anon/authenticated'
);

select is(
  (select count(*)::int from pg_tables where schemaname = 'app' and not rowsecurity),
  0,
  'RLS включён у всех таблиц app'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'app'),
  0,
  'политик RLS в app нет (правила в TypeScript, Q-26)'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'),
  0,
  'функций в схеме app нет'
);

select is(
  (select count(*)::int from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and not tg.tgisinternal),
  0,
  'пользовательских триггеров в app нет'
);

select is((select count(*)::int from app.character_classes), 17, '17 классов из прототипа');

-- Тестовые пользователи Auth.
insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000001', 'one@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000002', 'two@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000003', 'three@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values ('00000000-0000-0000-0000-000000000001', 'Один', 'Ник', 1, 'applicant');

select lives_ok(
  $$insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
    values ('00000000-0000-0000-0000-000000000002', 'Два', 'ник', 1, 'applicant')$$,
  'ник уникален с учётом регистра: «ник» допустим рядом с «Ник»'
);

select throws_ok(
  $$insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
    values ('00000000-0000-0000-0000-000000000003', 'Три', 'Ник', 1, 'applicant')$$,
  '23505', null, 'повторный «Ник» отклоняется'
);

select throws_ok(
  $$insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
    values ('00000000-0000-0000-0000-000000000003', 'Три', 'Десятьсимв', 1, 'applicant')$$,
  '23514', null, 'ник длиннее 9 символов отклоняется'
);

select throws_ok(
  $$insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
    values ('00000000-0000-0000-0000-000000000003', 'Три', 'Тр', 1, 'guest')$$,
  '23514', null, 'неизвестная роль отклоняется'
);

insert into app.join_applications (applicant_id, status)
values ('00000000-0000-0000-0000-000000000001', 'pending_officer_review');

select throws_ok(
  $$insert into app.join_applications (applicant_id, status)
    values ('00000000-0000-0000-0000-000000000001', 'pending_vote')$$,
  '23505', null, 'вторая активная заявка отклоняется'
);

select lives_ok(
  $$insert into app.join_applications (applicant_id, status, decided_at)
    values ('00000000-0000-0000-0000-000000000001', 'officer_rejected', now())$$,
  'завершённые заявки не ограничены'
);

select throws_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'пользователя Auth с профилем удалить нельзя'
);

select throws_ok(
  $$insert into app.audit_log (category, action, summary, details)
    values ('profiles', 'x', 'y', '[]'::jsonb)$$,
  '23514', null, 'details аудита — только объект'
);

select throws_ok(
  $$update app.profiles set is_primary_admin = true
    where id = '00000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'основной администратор обязан иметь роль admin'
);

select * from finish();
rollback;
