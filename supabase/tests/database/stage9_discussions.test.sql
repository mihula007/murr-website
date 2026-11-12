-- Схема этапа 9: ветки обсуждений, сообщения, реакции и отметки прочтения.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('discussion_threads', 'discussion_messages',
        'discussion_reactions', 'discussion_reads')),
  'RLS включён у таблиц обсуждений'
);

select ok(
  not exists (
    select 1
    from unnest(array['app.discussion_threads', 'app.discussion_messages',
        'app.discussion_reactions', 'app.discussion_reads']) as t(name),
      unnest(array['anon', 'authenticated']) as r(role)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на таблицы обсуждений'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000091', 'a9@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000092', 'b9@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000091', 'А', 'Alpha9', 1, 'officer'),
  ('00000000-0000-0000-0000-000000000092', 'Б', 'Beta9', 1, 'member');

insert into app.events (id, title, event_type, description, starts_at, created_by)
values ('00000000-0000-0000-0000-0000000009e1', 'Событие', 'pvp', 'Описание', now() + interval '1 day',
  '00000000-0000-0000-0000-000000000091');

insert into app.votes (id, kind, title, created_by)
values ('00000000-0000-0000-0000-0000000009f1', 'general', 'Голосование',
  '00000000-0000-0000-0000-000000000091');

select throws_ok(
  $$insert into app.discussion_threads (event_id, vote_id)
    values ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009f1')$$,
  '23514', null, 'у ветки ровно один родитель: два — отклоняется'
);

select throws_ok(
  $$insert into app.discussion_threads default values$$,
  '23514', null, 'ветка без родителя отклоняется'
);

insert into app.discussion_threads (id, event_id)
values ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009e1');
insert into app.discussion_threads (id, vote_id)
values ('00000000-0000-0000-0000-0000000009a2', '00000000-0000-0000-0000-0000000009f1');

select throws_ok(
  $$insert into app.discussion_threads (event_id) values ('00000000-0000-0000-0000-0000000009e1')$$,
  '23505', null, 'одна ветка на родителя'
);

select throws_ok(
  $$insert into app.discussion_messages (thread_id, author_id, body)
    values ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-000000000091', '')$$,
  '23514', null, 'пустое сообщение отклоняется (DSC-03)'
);

select throws_ok(
  format($$insert into app.discussion_messages (thread_id, author_id, body)
    values ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-000000000091', %L)$$,
    repeat('я', 2001)),
  '23514', null, 'сообщение длиннее 2000 символов отклоняется (DSC-03)'
);

insert into app.discussion_messages (id, thread_id, author_id, body)
values
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009a1',
    '00000000-0000-0000-0000-000000000092', 'Привет'),
  ('00000000-0000-0000-0000-0000000009b2', '00000000-0000-0000-0000-0000000009a2',
    '00000000-0000-0000-0000-000000000092', 'В голосовании');
insert into app.discussion_messages (id, thread_id, author_id, reply_to_id, body)
values ('00000000-0000-0000-0000-0000000009b3', '00000000-0000-0000-0000-0000000009a1',
  '00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-0000000009b1', 'Ответ');

insert into app.discussion_reactions (message_id, user_id, emoji)
values
  ('00000000-0000-0000-0000-0000000009b3', '00000000-0000-0000-0000-000000000092', '👍'),
  ('00000000-0000-0000-0000-0000000009b3', '00000000-0000-0000-0000-000000000092', '🤡');

select throws_ok(
  $$insert into app.discussion_reactions (message_id, user_id, emoji)
    values ('00000000-0000-0000-0000-0000000009b3', '00000000-0000-0000-0000-000000000092', '👍')$$,
  '23505', null, 'одна реакция каждого вида от аккаунта (DSC-11)'
);

select throws_ok(
  $$insert into app.discussion_reactions (message_id, user_id, emoji)
    values ('00000000-0000-0000-0000-0000000009b3', '00000000-0000-0000-0000-000000000092', '😮')$$,
  '23514', null, 'реакция вне набора отклоняется (Q-60)'
);

insert into app.discussion_reads (thread_id, user_id, read_up_to)
values ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-000000000092', now());

select lives_ok(
  $$insert into app.user_notifications (recipient_id, actor_id, kind, title, source_kind, source_id)
    values ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000091',
      'discussion_reply', 'Ответ', 'discussion_message', '00000000-0000-0000-0000-0000000009b3')$$,
  'уведомление об ответе в обсуждении допустимо (DSC-07)'
);

delete from app.profiles where id = '00000000-0000-0000-0000-000000000092';

select is(
  (select author_id from app.discussion_messages where id = '00000000-0000-0000-0000-0000000009b1'),
  null,
  'сообщение удалённого пользователя остаётся без автора (DSC-16)'
);

select is(
  (select count(*)::int from app.discussion_reactions
    where message_id = '00000000-0000-0000-0000-0000000009b3' and user_id is null),
  2,
  'реакции удалённого пользователя остаются обезличенными (DSC-17)'
);

select is(
  (select count(*)::int from app.discussion_reads where thread_id = '00000000-0000-0000-0000-0000000009a1'),
  0,
  'отметки прочтения удалённого пользователя удаляются (DSC-17)'
);

delete from app.votes where id = '00000000-0000-0000-0000-0000000009f1';
delete from app.events where id = '00000000-0000-0000-0000-0000000009e1';

select is(
  (select count(*)::int from app.discussion_messages
    where thread_id in ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009a2')),
  0,
  'удаление родителя очищает его ветку (DSC-14)'
);

select * from finish();
rollback;
