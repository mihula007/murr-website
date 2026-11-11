-- Схема этапа 7: группы, шаблоны групп и итог закрытого события.
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('event_groups', 'event_group_members', 'group_templates',
        'group_template_groups', 'group_template_members', 'event_activity_records')),
  'RLS включён у таблиц групп и итога'
);

select ok(
  not exists (
    select 1
    from unnest(array['app.event_groups', 'app.event_group_members',
        'app.group_templates', 'app.group_template_groups',
        'app.group_template_members', 'app.event_activity_records']) as t(name),
      unnest(array['anon', 'authenticated']) as r(role)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на таблицы групп и итога'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000071', 'a7@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000072', 'b7@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000073', 'c7@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000071', 'А', 'Alpha7', 1, 'member'),
  ('00000000-0000-0000-0000-000000000072', 'Б', 'Beta7', 1, 'member'),
  ('00000000-0000-0000-0000-000000000073', 'В', 'Gamma7', 1, 'officer');

insert into app.events (id, title, event_type, description, starts_at)
values
  ('00000000-0000-0000-0000-0000000000f1', 'Рейд', 'pve', 'Описание', '2026-11-14 17:00:00+00'),
  ('00000000-0000-0000-0000-0000000000f2', 'Осада', 'pvp', 'Описание', '2026-11-15 17:00:00+00');

insert into app.event_groups (id, event_id, name)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'Пати 1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 'Пати 2'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f2', 'Пати 1');

select throws_ok(
  $$insert into app.event_groups (event_id, name)
    values ('00000000-0000-0000-0000-0000000000f1', '')$$,
  '23514', null, 'пустое название группы отклоняется (GRP-03)'
);

insert into app.event_group_members (event_id, user_id, group_id, position, is_leader)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000071',
    '00000000-0000-0000-0000-0000000000a1', 0, true),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000072',
    '00000000-0000-0000-0000-0000000000a1', 1, false);

select throws_ok(
  $$insert into app.event_group_members (event_id, user_id, group_id, position)
    values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000071',
      '00000000-0000-0000-0000-0000000000a2', 0)$$,
  '23505', null, 'участник не попадает во вторую группу того же события (GRP-06)'
);

select throws_ok(
  $$insert into app.event_group_members (event_id, user_id, group_id, position)
    values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000073',
      '00000000-0000-0000-0000-0000000000a3', 0)$$,
  '23503', null, 'группа другого события не принимается'
);

select throws_ok(
  $$update app.event_group_members set is_leader = true
    where user_id = '00000000-0000-0000-0000-000000000072'
      and event_id = '00000000-0000-0000-0000-0000000000f1'$$,
  '23505', null, 'у группы один лидер (GRP-08)'
);

select lives_ok(
  $$insert into app.event_group_members (event_id, user_id, group_id, position)
    values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000071',
      '00000000-0000-0000-0000-0000000000a3', 0)$$,
  'тот же участник может быть в группе другого события'
);

select throws_ok(
  $$set constraints all immediate;
    insert into app.event_group_members (event_id, user_id, group_id, position)
    values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000073',
      '00000000-0000-0000-0000-0000000000a1', 1)$$,
  '23505', null, 'две позиции в группе не совпадают'
);
set constraints all deferred;

delete from app.event_groups where id = '00000000-0000-0000-0000-0000000000a2';
delete from app.event_groups where id = '00000000-0000-0000-0000-0000000000a1';

select is(
  (select count(*)::int from app.event_group_members
    where event_id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'удаление группы возвращает людей в пул (GRP-09)'
);

-- Шаблоны групп.
insert into app.group_templates (id, name, created_by)
values ('00000000-0000-0000-0000-0000000000b1', 'Состав', '00000000-0000-0000-0000-000000000073');
insert into app.group_template_groups (id, template_id, name, position)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Пати 1', 0),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 'Пати 2', 1);
insert into app.group_template_members (template_id, user_id, group_id, position, is_leader)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000072',
  '00000000-0000-0000-0000-0000000000c1', 0, true);

select throws_ok(
  $$insert into app.group_template_members (template_id, user_id, group_id, position)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000072',
      '00000000-0000-0000-0000-0000000000c2', 0)$$,
  '23505', null, 'участник шаблона — в одной группе шаблона'
);

-- Итог закрытого события.
update app.events set closed_at = now() where id = '00000000-0000-0000-0000-0000000000f1';

insert into app.event_activity_records (event_id, user_id, nickname, class_id, status, group_name, is_leader)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000071', 'Alpha7', 1, 'visited', 'Пати 1', true),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000072', 'Beta7', 1, 'missed', null, false),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000073', 'Gamma7', 1, 'unmarked', null, false);

select throws_ok(
  $$insert into app.event_activity_records (event_id, user_id, nickname, class_id, status, group_name)
    values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000071', 'Alpha7', 1, 'visited', 'Пати 1')$$,
  '23505', null, 'вторая запись участника по событию отклоняется (EVT-08)'
);

select throws_ok(
  $$insert into app.event_activity_records (event_id, user_id, nickname, class_id, status)
    values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000071', 'Alpha7', 1, 'visited')$$,
  '23514', null, 'посетивший без группы отклоняется'
);

select throws_ok(
  $$insert into app.event_activity_records (event_id, user_id, nickname, class_id, status, is_leader)
    values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000072', 'Beta7', 1, 'missed', true)$$,
  '23514', null, 'лидер без посещения отклоняется'
);

select throws_ok(
  $$insert into app.event_activity_records (event_id, user_id, nickname, class_id, status)
    values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000072', 'Beta7', 1, 'absent')$$,
  '23514', null, 'неизвестный статус отклоняется'
);

select throws_ok(
  $$delete from app.events where id = '00000000-0000-0000-0000-0000000000f1'$$,
  '23503', null, 'закрытое событие с итогом не удаляется (EVT-10)'
);

update app.profiles set game_nickname = 'Renamed'
  where id = '00000000-0000-0000-0000-000000000071';

select is(
  (select nickname from app.event_activity_records
    where user_id = '00000000-0000-0000-0000-000000000071'),
  'Alpha7',
  'смена ника не меняет историю (ACT-03)'
);

delete from app.profiles where id = '00000000-0000-0000-0000-000000000072';

select is(
  (select count(*)::int from app.event_activity_records
    where user_id = '00000000-0000-0000-0000-000000000072'),
  0,
  'итог удалённого пользователя удаляется (ACT-17)'
);

select is(
  (select count(*)::int from app.group_template_members
    where user_id = '00000000-0000-0000-0000-000000000072'),
  0,
  'участник шаблона удаляется вместе с пользователем, лидера не остаётся'
);

delete from app.profiles where id = '00000000-0000-0000-0000-000000000073';

select is(
  (select count(*)::int from app.group_templates
    where id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'шаблоны групп удалённого пользователя удаляются (Q-33)'
);

select * from finish();
rollback;
