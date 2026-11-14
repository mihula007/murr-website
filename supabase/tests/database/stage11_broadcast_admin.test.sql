-- Схема этапа 11: рассылки и служебная запись удаления пользователя.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('broadcast_drafts', 'broadcast_templates', 'user_deletions')),
  'RLS включён у таблиц этапа 11'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as r(role)
    cross join unnest(array['app.broadcast_drafts', 'app.broadcast_templates',
      'app.user_deletions']) as t(name)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на таблицы этапа 11'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-0000000011a1', 'a11@example.test', now(),
  'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values ('00000000-0000-0000-0000-0000000011a1', 'А', 'Alpha11', 1, 'officer');

select lives_ok(
  $$insert into app.broadcast_drafts (author_id, body, channels)
    values ('00000000-0000-0000-0000-0000000011a1', 'Текст',
      array['telegram', 'vk'])$$,
  'черновик сохраняется'
);

select throws_ok(
  $$insert into app.broadcast_drafts (author_id, body, channels)
    values ('00000000-0000-0000-0000-0000000011a1', 'Текст', array[]::text[])$$,
  '23514', null, 'черновик без каналов отклоняется'
);

select throws_ok(
  $$insert into app.broadcast_drafts (author_id, body, channels)
    values ('00000000-0000-0000-0000-0000000011a1', 'Текст', array['email'])$$,
  '23514', null, 'неизвестный канал отклоняется'
);

select throws_ok(
  $$insert into app.broadcast_drafts (author_id, body, channels, source_kind)
    values ('00000000-0000-0000-0000-0000000011a1', 'Текст', array['vk'], 'event')$$,
  '23514', null, 'источник без id отклоняется'
);

select lives_ok(
  $$insert into app.broadcast_templates (author_id, name, body, channels)
    values ('00000000-0000-0000-0000-0000000011a1', 'Сбор', 'Текст', array['max'])$$,
  'шаблон сохраняется'
);

select throws_ok(
  $$insert into app.broadcast_templates (author_id, name, body, channels)
    values ('00000000-0000-0000-0000-0000000011a1', 'СБОР', 'Другой', array['max'])$$,
  '23505', null, 'название шаблона уникально без учёта регистра'
);

insert into app.user_deletions (user_id, requested_by, nickname, email, stage)
values ('00000000-0000-0000-0000-0000000011a1',
  '00000000-0000-0000-0000-0000000011a1', 'Alpha11', 'a11@example.test',
  'database');

delete from app.profiles where id = '00000000-0000-0000-0000-0000000011a1';

select is(
  (select count(*)::int from app.broadcast_drafts
    where author_id = '00000000-0000-0000-0000-0000000011a1')
  + (select count(*)::int from app.broadcast_templates
    where author_id = '00000000-0000-0000-0000-0000000011a1'),
  0,
  'черновики и шаблоны удаляются вместе с автором'
);

select is(
  (select requested_by from app.user_deletions
    where user_id = '00000000-0000-0000-0000-0000000011a1'),
  null,
  'служебная запись удаления переживает профиль'
);

select throws_ok(
  $$update app.user_deletions set stage = 'done'
    where user_id = '00000000-0000-0000-0000-0000000011a1'$$,
  '23514', null, 'неизвестный этап удаления отклоняется'
);

select * from finish();
rollback;
