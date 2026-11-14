-- Схема этапа 14: связь с MAX, коды привязки, анонсы событий.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('max_links', 'max_link_codes',
        'max_announcements', 'max_event_messages')),
  'RLS включён у таблиц этапа 14'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as r(role)
    cross join unnest(array['app.max_links', 'app.max_link_codes',
      'app.max_announcements', 'app.max_event_messages']) as t(name)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на таблицы этапа 14'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-0000000014a1', 'a14@example.test', now(),
    'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000014a2', 'b14@example.test', now(),
    'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-0000000014a1', 'А', 'Alpha14', 1, 'member'),
  ('00000000-0000-0000-0000-0000000014a2', 'Б', 'Bravo14', 1, 'officer');

insert into app.events (id, title, event_type, description, starts_at, created_by)
values ('00000000-0000-0000-0000-0000000014e1', 'Рейд', 'pve', 'Описание',
  '2026-11-20 17:00:00+00', '00000000-0000-0000-0000-0000000014a2');

select lives_ok(
  $$insert into app.max_links (user_id, max_user_id, chat_id, username, display_name)
    values ('00000000-0000-0000-0000-0000000014a1', 1001, 1001, 'alpha', 'Alpha')$$,
  'связь сохраняется'
);

select throws_ok(
  $$insert into app.max_links (user_id, max_user_id, chat_id, display_name)
    values ('00000000-0000-0000-0000-0000000014a2', 1001, 1001, 'Other')$$,
  '23505', null, 'один MAX связан только с одним аккаунтом'
);

select throws_ok(
  $$insert into app.max_links (user_id, max_user_id, chat_id, display_name)
    values ('00000000-0000-0000-0000-0000000014a1', 1002, 1002, 'Second')$$,
  '23505', null, 'у аккаунта только одна связь'
);

select lives_ok(
  $$insert into app.max_link_codes (user_id, code_hash, expires_at)
    values ('00000000-0000-0000-0000-0000000014a2', repeat('a', 64), now())$$,
  'код привязки сохраняется хешем'
);

select throws_ok(
  $$insert into app.max_link_codes (user_id, code_hash, expires_at)
    values ('00000000-0000-0000-0000-0000000014a1', 'plain-code', now())$$,
  '23514', null, 'код в открытом виде отклоняется'
);

select throws_ok(
  $$insert into app.max_link_codes (user_id, code_hash, expires_at)
    values ('00000000-0000-0000-0000-0000000014a1', repeat('a', 64), now())$$,
  '23505', null, 'хеш кода уникален'
);

insert into app.max_announcements (id, event_id, subject, body)
values ('00000000-0000-0000-0000-0000000014c1',
  '00000000-0000-0000-0000-0000000014e1', 'Рейд', 'Сбор в 20:00');

select throws_ok(
  $$insert into app.max_event_messages
      (event_id, user_id, announcement_id, chat_id, message_id)
    values ('00000000-0000-0000-0000-0000000014e1',
      '00000000-0000-0000-0000-0000000014a1',
      '00000000-0000-0000-0000-0000000014c1', 1001, '')$$,
  '23514', null, 'пустой mid отклоняется'
);

select lives_ok(
  $$insert into app.max_event_messages
      (event_id, user_id, announcement_id, chat_id, message_id)
    values ('00000000-0000-0000-0000-0000000014e1',
      '00000000-0000-0000-0000-0000000014a1',
      '00000000-0000-0000-0000-0000000014c1', 1001, 'mid.7')$$,
  'активное сообщение сохраняется'
);

select throws_ok(
  $$insert into app.max_event_messages
      (event_id, user_id, announcement_id, chat_id, message_id)
    values ('00000000-0000-0000-0000-0000000014e1',
      '00000000-0000-0000-0000-0000000014a1',
      '00000000-0000-0000-0000-0000000014c1', 1001, 'mid.8')$$,
  '23505', null, 'одно активное сообщение участника на событие'
);

delete from app.profiles where id = '00000000-0000-0000-0000-0000000014a1';

select is(
  (select count(*)::int from app.max_links
    where user_id = '00000000-0000-0000-0000-0000000014a1')
  + (select count(*)::int from app.max_event_messages
    where user_id = '00000000-0000-0000-0000-0000000014a1'),
  0,
  'связь и сообщения удаляются вместе с пользователем'
);

delete from app.events where id = '00000000-0000-0000-0000-0000000014e1';

select is(
  (select count(*)::int from app.max_announcements
    where event_id = '00000000-0000-0000-0000-0000000014e1'),
  0,
  'анонсы удаляются вместе с событием'
);

delete from app.profiles where id = '00000000-0000-0000-0000-0000000014a2';

select is(
  (select count(*)::int from app.max_link_codes
    where user_id = '00000000-0000-0000-0000-0000000014a2'),
  0,
  'код привязки удаляется вместе с пользователем'
);

select * from finish();
rollback;
