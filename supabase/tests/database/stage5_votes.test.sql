-- Схема этапа 5: голосования, варианты и голоса.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('votes', 'vote_options', 'vote_ballots')),
  'RLS включён у таблиц голосований'
);

select ok(
  not exists (
    select 1
    from unnest(array['app.votes', 'app.vote_options', 'app.vote_ballots']) as t(name),
      unnest(array['anon', 'authenticated']) as r(role)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на таблицы голосований'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000051', 'cand5@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000052', 'member5@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000053', 'officer5@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000051', 'Кандидат', 'Cand5', 1, 'applicant'),
  ('00000000-0000-0000-0000-000000000052', 'Член', 'Member5', 1, 'member'),
  ('00000000-0000-0000-0000-000000000053', 'Офицер', 'Officer5', 1, 'officer');

insert into app.join_applications (id, applicant_id, status)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000051', 'pending_vote');

insert into app.votes (id, kind, title, created_by)
values
  ('00000000-0000-0000-0000-0000000000c1', 'general', 'Обычное', '00000000-0000-0000-0000-000000000053'),
  ('00000000-0000-0000-0000-0000000000c2', 'general', 'Второе', '00000000-0000-0000-0000-000000000053');

insert into app.vote_options (id, vote_id, label, normalized_label, position)
values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Да', 'да', 0),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Нет', 'нет', 1),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c2', 'А', 'а', 0);

select throws_ok(
  $$insert into app.vote_options (vote_id, label, normalized_label, position)
    values ('00000000-0000-0000-0000-0000000000c1', 'да', 'да', 2)$$,
  '23505', null, 'повтор варианта без учёта регистра отклоняется'
);

select throws_ok(
  $$insert into app.votes (kind, title) values ('application', 'Без заявки')$$,
  '23514', null, 'голосование по заявке без заявки отклоняется'
);

select throws_ok(
  $$insert into app.votes (kind, title, application_id)
    values ('general', 'Обычное с заявкой', '00000000-0000-0000-0000-0000000000b1')$$,
  '23514', null, 'обычное голосование не связывается с заявкой'
);

select throws_ok(
  $$update app.votes set closed_by = '00000000-0000-0000-0000-000000000053'
    where id = '00000000-0000-0000-0000-0000000000c2'$$,
  '23514', null, 'завершивший без времени завершения отклоняется'
);

insert into app.votes (id, kind, title, application_id)
values ('00000000-0000-0000-0000-0000000000c3', 'application', 'Заявка: Cand5',
  '00000000-0000-0000-0000-0000000000b1');

select throws_ok(
  $$insert into app.votes (kind, title, application_id)
    values ('application', 'Заявка: Cand5', '00000000-0000-0000-0000-0000000000b1')$$,
  '23505', null, 'второе активное голосование по заявке отклоняется'
);

insert into app.vote_options (id, vote_id, label, normalized_label, position)
values ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c3', 'За', 'за', 0);

select throws_ok(
  $$insert into app.vote_ballots (vote_id, option_id, voter_id)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d3',
      '00000000-0000-0000-0000-000000000052')$$,
  '23503', null, 'голос с вариантом другого голосования отклоняется'
);

select lives_ok(
  $$insert into app.vote_ballots (vote_id, option_id, voter_id)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1',
      '00000000-0000-0000-0000-000000000052')$$,
  'голос участника сохраняется'
);

select throws_ok(
  $$insert into app.vote_ballots (vote_id, option_id, voter_id)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2',
      '00000000-0000-0000-0000-000000000052')$$,
  '23505', null, 'второй голос того же участника отклоняется'
);

insert into app.vote_ballots (vote_id, option_id, voter_id)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d4',
  '00000000-0000-0000-0000-000000000052');

delete from app.profiles where id = '00000000-0000-0000-0000-000000000052';

select is(
  (select count(*)::int from app.vote_ballots
    where vote_id = '00000000-0000-0000-0000-0000000000c1' and voter_id is null),
  1,
  'удаление участника сохраняет голос обезличенно (VOT-16)'
);

delete from app.profiles where id = '00000000-0000-0000-0000-000000000053';

select is(
  (select created_by from app.votes where id = '00000000-0000-0000-0000-0000000000c1'),
  null,
  'удаление создателя сохраняет голосование без автора (VOT-15)'
);

delete from app.join_applications where id = '00000000-0000-0000-0000-0000000000b1';

select is(
  (select count(*)::int from app.votes where id = '00000000-0000-0000-0000-0000000000c3'),
  0,
  'удаление заявки удаляет связанное голосование (APP-15)'
);

select is(
  (select count(*)::int from app.vote_ballots
    where vote_id = '00000000-0000-0000-0000-0000000000c3'),
  0,
  'голоса связанного голосования удаляются вместе с ним'
);

select * from finish();
rollback;
