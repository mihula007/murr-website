-- Схема этапа 10: виды уведомлений и отметки просмотра разделов.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

select ok(
  (select rowsecurity from pg_tables
    where schemaname = 'app' and tablename = 'section_views'),
  'RLS включён у отметок просмотра'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as r(role)
    where has_table_privilege(r.role, 'app.section_views',
      'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на отметки просмотра'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-0000000010a1', 'a10@example.test', now(),
  'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values ('00000000-0000-0000-0000-0000000010a1', 'А', 'Alpha10', 1, 'member');

select lives_ok(
  $$insert into app.section_views (user_id, section, seen_at)
    values ('00000000-0000-0000-0000-0000000010a1', 'events', now())$$,
  'отметка раздела сохраняется'
);

select throws_ok(
  $$insert into app.section_views (user_id, section, seen_at)
    values ('00000000-0000-0000-0000-0000000010a1', 'roster', now())$$,
  '23514', null, 'неизвестный раздел отклоняется'
);

select throws_ok(
  $$insert into app.section_views (user_id, section, seen_at)
    values ('00000000-0000-0000-0000-0000000010a1', 'events', now())$$,
  '23505', null, 'одна отметка на пользователя и раздел'
);

select lives_ok(
  $$insert into app.user_notifications
      (recipient_id, kind, title, source_kind, source_id)
    values ('00000000-0000-0000-0000-0000000010a1', 'group_leader', 'Лидер',
      'event', 'e1')$$,
  'новый вид уведомления принимается'
);

delete from app.profiles where id = '00000000-0000-0000-0000-0000000010a1';

select is(
  (select count(*)::int from app.section_views
    where user_id = '00000000-0000-0000-0000-0000000010a1'),
  0,
  'отметки удаляются вместе с пользователем'
);

select * from finish();
rollback;
