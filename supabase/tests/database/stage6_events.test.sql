-- Схема этапа 6: события, ответы, шаблоны и расписание выпуска.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('events', 'event_attendance', 'event_templates')),
  'RLS включён у таблиц событий'
);

select ok(
  not exists (
    select 1
    from unnest(array['app.events', 'app.event_attendance', 'app.event_templates']) as t(name),
      unnest(array['anon', 'authenticated']) as r(role)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на таблицы событий'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000061', 'member6@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000062', 'officer6@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000061', 'Член', 'Member6', 1, 'member'),
  ('00000000-0000-0000-0000-000000000062', 'Офицер', 'Officer6', 1, 'officer');

insert into app.events (id, title, event_type, description, starts_at, created_by)
values ('00000000-0000-0000-0000-0000000000e1', 'Рейд', 'pve', 'Описание',
  '2026-11-14 17:00:00+00', '00000000-0000-0000-0000-000000000062');

select throws_ok(
  $$insert into app.events (title, event_type, description, starts_at)
    values ('Рейд', 'raid', 'Описание', now())$$,
  '23514', null, 'неизвестный тип события отклоняется'
);

select throws_ok(
  $$insert into app.events (title, event_type, description, starts_at)
    values ('Рейд', 'pve', '', now())$$,
  '23514', null, 'пустое описание отклоняется'
);

-- Дата в прошлом: локальная БД может уже содержать настоящий выпуск недели.
insert into app.events (title, event_type, description, starts_at, recurring_preset)
values ('МТВ', 'clan', 'Еженедельное', '2000-01-01 17:00:00+00', 'mtv_sat_20');

select throws_ok(
  $$insert into app.events (title, event_type, description, starts_at, recurring_preset)
    values ('МТВ', 'clan', 'Еженедельное', '2000-01-01 17:00:00+00', 'mtv_sat_20')$$,
  '23505', null, 'второй выпуск пресета на то же время отклоняется (EVT-14)'
);

select throws_ok(
  $$insert into app.events (title, event_type, description, starts_at, recurring_preset)
    values ('X', 'clan', 'Y', now(), 'unknown')$$,
  '23514', null, 'неизвестный пресет отклоняется'
);

select lives_ok(
  $$insert into app.event_attendance (event_id, user_id, answer)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000061', 'yes')$$,
  'ответ участника сохраняется'
);

select throws_ok(
  $$insert into app.event_attendance (event_id, user_id, answer)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000061', 'maybe')$$,
  '23505', null, 'второй ответ того же участника отклоняется (EVT-05)'
);

select throws_ok(
  $$insert into app.event_attendance (event_id, user_id, answer)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000062', 'later')$$,
  '23514', null, 'неизвестный ответ отклоняется'
);

insert into app.event_templates (title, event_type, description, weekday, time_msk, created_by)
values ('Шаблон', 'pvp', 'Описание', 6, '20:00', '00000000-0000-0000-0000-000000000062');

delete from app.profiles where id = '00000000-0000-0000-0000-000000000062';

select is(
  (select created_by from app.events where id = '00000000-0000-0000-0000-0000000000e1'),
  null,
  'удаление автора сохраняет событие без автора (EVT-16)'
);

select is(
  (select count(*)::int from app.event_templates where title = 'Шаблон'),
  0,
  'шаблоны удалённого пользователя удаляются (ADM-08)'
);

delete from app.events where id = '00000000-0000-0000-0000-0000000000e1';

select is(
  (select count(*)::int from app.event_attendance
    where event_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'удаление события удаляет ответы (EVT-10)'
);

select is(
  (select schedule from cron.job where jobname = 'events-ensure-weekly'),
  '0 21 * * 0',
  'выпуск постоянных событий — понедельник 00:00 МСК (Q-42)'
);

select ok(
  exists (select 1 from cron.job where jobname = 'cron-history-cleanup'),
  'история заданий очищается по расписанию'
);

select * from finish();
rollback;
