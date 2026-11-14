-- Схема этапа 13: связь с Telegram, коды привязки, анонсы событий.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('telegram_links', 'telegram_link_codes',
        'telegram_announcements', 'telegram_event_messages')),
  'RLS включён у таблиц этапа 13'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as r(role)
    cross join unnest(array['app.telegram_links', 'app.telegram_link_codes',
      'app.telegram_announcements', 'app.telegram_event_messages']) as t(name)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на таблицы этапа 13'
);

select hasnt_column('app', 'broadcast_drafts', 'attachments',
  'у черновиков рассылки нет вложений (Q-82)');

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-0000000013a1', 'a13@example.test', now(),
    'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000013a2', 'b13@example.test', now(),
    'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-0000000013a1', 'А', 'Alpha13', 1, 'member'),
  ('00000000-0000-0000-0000-0000000013a2', 'Б', 'Bravo13', 1, 'officer');

insert into app.events (id, title, event_type, description, starts_at, created_by)
values ('00000000-0000-0000-0000-0000000013e1', 'Рейд', 'pve', 'Описание',
  '2026-11-20 17:00:00+00', '00000000-0000-0000-0000-0000000013a2');

select lives_ok(
  $$insert into app.telegram_links (user_id, telegram_user_id, chat_id, username, display_name)
    values ('00000000-0000-0000-0000-0000000013a1', 1001, 1001, 'alpha', 'Alpha')$$,
  'связь сохраняется'
);

select throws_ok(
  $$insert into app.telegram_links (user_id, telegram_user_id, chat_id, display_name)
    values ('00000000-0000-0000-0000-0000000013a2', 1001, 1001, 'Other')$$,
  '23505', null, 'один Telegram связан только с одним аккаунтом'
);

select throws_ok(
  $$insert into app.telegram_links (user_id, telegram_user_id, chat_id, display_name)
    values ('00000000-0000-0000-0000-0000000013a1', 1002, 1002, 'Second')$$,
  '23505', null, 'у аккаунта только одна связь'
);

select lives_ok(
  $$insert into app.telegram_link_codes (user_id, code_hash, expires_at)
    values ('00000000-0000-0000-0000-0000000013a2', repeat('a', 64), now())$$,
  'код привязки сохраняется хешем'
);

select throws_ok(
  $$insert into app.telegram_link_codes (user_id, code_hash, expires_at)
    values ('00000000-0000-0000-0000-0000000013a1', 'plain-code', now())$$,
  '23514', null, 'код в открытом виде отклоняется'
);

select throws_ok(
  $$insert into app.telegram_link_codes (user_id, code_hash, expires_at)
    values ('00000000-0000-0000-0000-0000000013a1', repeat('a', 64), now())$$,
  '23505', null, 'хеш кода уникален'
);

insert into app.telegram_announcements (id, event_id, subject, body)
values ('00000000-0000-0000-0000-0000000013c1',
  '00000000-0000-0000-0000-0000000013e1', 'Рейд', 'Сбор в 20:00');

select lives_ok(
  $$insert into app.telegram_event_messages
      (event_id, user_id, announcement_id, chat_id, message_id)
    values ('00000000-0000-0000-0000-0000000013e1',
      '00000000-0000-0000-0000-0000000013a1',
      '00000000-0000-0000-0000-0000000013c1', 1001, 7)$$,
  'активное сообщение сохраняется'
);

select throws_ok(
  $$insert into app.telegram_event_messages
      (event_id, user_id, announcement_id, chat_id, message_id)
    values ('00000000-0000-0000-0000-0000000013e1',
      '00000000-0000-0000-0000-0000000013a1',
      '00000000-0000-0000-0000-0000000013c1', 1001, 8)$$,
  '23505', null, 'одно активное сообщение участника на событие'
);

select throws_ok(
  $$insert into app.broadcast_drafts (author_id, body, channels)
    values ('00000000-0000-0000-0000-0000000013a2', repeat('x', 3801),
      array['telegram'])$$,
  '23514', null, 'текст черновика не длиннее 3800 (Q-91)'
);

select throws_ok(
  $$insert into app.broadcast_templates (author_id, name, body, channels)
    values ('00000000-0000-0000-0000-0000000013a2', 'Длинный', repeat('x', 3801),
      array['telegram'])$$,
  '23514', null, 'текст шаблона не длиннее 3800 (Q-91)'
);

delete from app.profiles where id = '00000000-0000-0000-0000-0000000013a1';

select is(
  (select count(*)::int from app.telegram_links
    where user_id = '00000000-0000-0000-0000-0000000013a1')
  + (select count(*)::int from app.telegram_event_messages
    where user_id = '00000000-0000-0000-0000-0000000013a1'),
  0,
  'связь и сообщения удаляются вместе с пользователем'
);

delete from app.events where id = '00000000-0000-0000-0000-0000000013e1';

select is(
  (select count(*)::int from app.telegram_announcements
    where event_id = '00000000-0000-0000-0000-0000000013e1'),
  0,
  'анонсы удаляются вместе с событием'
);

delete from app.profiles where id = '00000000-0000-0000-0000-0000000013a2';

select is(
  (select count(*)::int from app.telegram_link_codes
    where user_id = '00000000-0000-0000-0000-0000000013a2'),
  0,
  'код привязки удаляется вместе с пользователем'
);

select * from finish();
rollback;
