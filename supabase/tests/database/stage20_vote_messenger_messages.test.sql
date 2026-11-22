-- Схема активных рассылок голосований для трёх мессенджеров.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('telegram_vote_announcements', 'telegram_vote_messages',
        'max_vote_announcements', 'max_vote_messages',
        'vk_vote_announcements', 'vk_vote_messages')),
  'RLS включён у шести таблиц голосований'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as r(role)
    cross join unnest(array['app.telegram_vote_announcements',
      'app.telegram_vote_messages', 'app.max_vote_announcements',
      'app.max_vote_messages', 'app.vk_vote_announcements',
      'app.vk_vote_messages']) as t(name)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют доступа к таблицам голосований'
);

select has_pk('app', 'telegram_vote_messages', 'составной ключ Telegram: голосование и участник');
select has_pk('app', 'max_vote_messages', 'составной ключ MAX: голосование и участник');
select has_pk('app', 'vk_vote_messages', 'составной ключ ВКонтакте: голосование и участник');
select col_type_is('app', 'telegram_vote_messages', 'message_id', 'bigint', 'ID сообщения Telegram — число');
select col_type_is('app', 'max_vote_messages', 'message_id', 'text', 'ID сообщения MAX — строка');
select col_type_is('app', 'vk_vote_messages', 'message_id', 'bigint', 'ID сообщения ВКонтакте — число');

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-0000000020a1', 'a20@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000020a2', 'b20@example.test', now(), 'authenticated', 'authenticated');
insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-0000000020a1', 'А', 'Alpha20', 1, 'member'),
  ('00000000-0000-0000-0000-0000000020a2', 'Б', 'Bravo20', 1, 'officer');
insert into app.votes (id, kind, title, created_by)
values
  ('00000000-0000-0000-0000-0000000020c1', 'general', 'Голос 1', '00000000-0000-0000-0000-0000000020a2'),
  ('00000000-0000-0000-0000-0000000020c2', 'general', 'Голос 2', '00000000-0000-0000-0000-0000000020a2');

insert into app.telegram_vote_announcements (id, vote_id, subject, body)
values
  ('00000000-0000-0000-0000-0000000020d1', '00000000-0000-0000-0000-0000000020c1', 'Голос 1', 'Текст'),
  ('00000000-0000-0000-0000-0000000020d2', '00000000-0000-0000-0000-0000000020c2', 'Голос 2', 'Текст');
insert into app.max_vote_announcements (id, vote_id, subject, body)
values
  ('00000000-0000-0000-0000-0000000020e1', '00000000-0000-0000-0000-0000000020c1', 'Голос 1', 'Текст'),
  ('00000000-0000-0000-0000-0000000020e2', '00000000-0000-0000-0000-0000000020c2', 'Голос 2', 'Текст');
insert into app.vk_vote_announcements (id, vote_id, subject, body)
values
  ('00000000-0000-0000-0000-0000000020f1', '00000000-0000-0000-0000-0000000020c1', 'Голос 1', 'Текст'),
  ('00000000-0000-0000-0000-0000000020f2', '00000000-0000-0000-0000-0000000020c2', 'Голос 2', 'Текст');

insert into app.telegram_vote_messages
  (vote_id, user_id, announcement_id, chat_id, message_id)
values
  ('00000000-0000-0000-0000-0000000020c1', '00000000-0000-0000-0000-0000000020a1', '00000000-0000-0000-0000-0000000020d1', 2001, 11),
  ('00000000-0000-0000-0000-0000000020c1', '00000000-0000-0000-0000-0000000020a2', '00000000-0000-0000-0000-0000000020d1', 2002, 11),
  ('00000000-0000-0000-0000-0000000020c2', '00000000-0000-0000-0000-0000000020a1', '00000000-0000-0000-0000-0000000020d2', 2001, 12);
insert into app.max_vote_messages
  (vote_id, user_id, announcement_id, chat_id, message_id)
values
  ('00000000-0000-0000-0000-0000000020c1', '00000000-0000-0000-0000-0000000020a1', '00000000-0000-0000-0000-0000000020e1', 2001, 'mid.11'),
  ('00000000-0000-0000-0000-0000000020c1', '00000000-0000-0000-0000-0000000020a2', '00000000-0000-0000-0000-0000000020e1', 2002, 'mid.11'),
  ('00000000-0000-0000-0000-0000000020c2', '00000000-0000-0000-0000-0000000020a1', '00000000-0000-0000-0000-0000000020e2', 2001, 'mid.12');
insert into app.vk_vote_messages
  (vote_id, user_id, announcement_id, chat_id, message_id)
values
  ('00000000-0000-0000-0000-0000000020c1', '00000000-0000-0000-0000-0000000020a1', '00000000-0000-0000-0000-0000000020f1', 2001, 11),
  ('00000000-0000-0000-0000-0000000020c1', '00000000-0000-0000-0000-0000000020a2', '00000000-0000-0000-0000-0000000020f1', 2002, 11),
  ('00000000-0000-0000-0000-0000000020c2', '00000000-0000-0000-0000-0000000020a1', '00000000-0000-0000-0000-0000000020f2', 2001, 12);

delete from app.profiles where id = '00000000-0000-0000-0000-0000000020a1';
select is((select count(*)::int from app.telegram_vote_messages where user_id = '00000000-0000-0000-0000-0000000020a1'), 0, 'сообщение Telegram удаляется вместе с участником');
select is((select count(*)::int from app.max_vote_messages where user_id = '00000000-0000-0000-0000-0000000020a1'), 0, 'сообщение MAX удаляется вместе с участником');
select is((select count(*)::int from app.vk_vote_messages where user_id = '00000000-0000-0000-0000-0000000020a1'), 0, 'сообщение ВКонтакте удаляется вместе с участником');

delete from app.votes where id = '00000000-0000-0000-0000-0000000020c1';
select is((select count(*)::int from app.telegram_vote_messages where user_id = '00000000-0000-0000-0000-0000000020a2'), 0, 'сообщение Telegram удаляется вместе с голосованием');
select is((select count(*)::int from app.telegram_vote_announcements where vote_id = '00000000-0000-0000-0000-0000000020c1'), 0, 'рассылка Telegram удаляется вместе с голосованием');
select is((select count(*)::int from app.max_vote_messages where user_id = '00000000-0000-0000-0000-0000000020a2'), 0, 'сообщение MAX удаляется вместе с голосованием');
select is((select count(*)::int from app.max_vote_announcements where vote_id = '00000000-0000-0000-0000-0000000020c1'), 0, 'рассылка MAX удаляется вместе с голосованием');
select is((select count(*)::int from app.vk_vote_messages where user_id = '00000000-0000-0000-0000-0000000020a2'), 0, 'сообщение ВКонтакте удаляется вместе с голосованием');
select is((select count(*)::int from app.vk_vote_announcements where vote_id = '00000000-0000-0000-0000-0000000020c1'), 0, 'рассылка ВКонтакте удаляется вместе с голосованием');

select * from finish();
rollback;
