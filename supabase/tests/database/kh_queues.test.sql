begin;

select plan(7);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000125', 'kh-one@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000126', 'kh-two@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000125', 'КХ1', 'КХНик', 1, 'member'),
  ('00000000-0000-0000-0000-000000000126', 'КХ2', 'КХНик2', 1, 'officer');

delete from app.kh_queue_entries;

select lives_ok(
  $$insert into app.kh_queue_entries (queue_key, user_id, game_nickname)
    values ('summons', '00000000-0000-0000-0000-000000000125', 'КХНик')$$,
  'активная запись в очереди создаётся'
);

select throws_ok(
  $$insert into app.kh_queue_entries (queue_key, user_id, game_nickname)
    values ('unknown', '00000000-0000-0000-0000-000000000126', 'КХНик2')$$,
  '23514', null, 'неизвестный ключ очереди отклоняется'
);

select throws_ok(
  $$insert into app.kh_queue_entries (queue_key, user_id, game_nickname)
    values ('summons', '00000000-0000-0000-0000-000000000125', 'КХНик')$$,
  '23505', null, 'повторная активная запись в одну очередь отклоняется'
);

select is(
  (select count(*)::int from app.kh_queue_entries where queue_key = 'summons'),
  1,
  'после повторной вставки остаётся ровно одна запись'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'app.kh_queue_entries'::regclass),
  'RLS включён для таблицы очередей'
);

select ok(
  not has_table_privilege('anon', 'app.kh_queue_entries', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'app.kh_queue_entries', 'select,insert,update,delete'),
  'Data API роли не имеют прямых прав на очереди'
);

delete from app.profiles where id = '00000000-0000-0000-0000-000000000125';
select is(
  (select count(*)::int from app.kh_queue_entries where user_id = '00000000-0000-0000-0000-000000000125'),
  0,
  'удаление профиля удаляет его активные записи'
);

select * from finish();
rollback;
