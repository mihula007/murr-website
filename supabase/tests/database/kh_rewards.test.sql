begin;

select plan(10);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000125', 'kh-rewards-one@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000126', 'kh-rewards-two@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000125', 'КХ1', 'КХНик', 1, 'member'),
  ('00000000-0000-0000-0000-000000000126', 'КХ2', 'КХНик2', 1, 'officer');

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'kh_queue_entries'
      and column_name = 'game_nickname'
  ),
  'активная очередь хранит снимок ника'
);

select ok(
  exists (
    select 1 from pg_attribute
    where attrelid = to_regclass('app.kh_queue_entries')
      and attname = 'user_id' and not attnotnull and not attisdropped
  ),
  'аккаунт у записи очереди необязательный'
);

select has_table('app', 'kh_queue_settings', 'настройка общего лимита хранится в базе');
select ok(
  coalesce(
    (select column_default = '14' from information_schema.columns
      where table_schema = 'app' and table_name = 'kh_queue_settings'
        and column_name = 'max_active_queues'),
    false
  ),
  'начальный общий лимит равен 14'
);
select has_table('app', 'kh_queue_rejoin_waitlist', 'ожидающие повторной записи хранятся в базе');
select has_table('app', 'kh_reward_history', 'выдачи наград хранятся в базе');

select lives_ok(
  $$insert into app.kh_queue_entries (queue_key, user_id, game_nickname)
    values ('pet', null, 'Не зарегистрирован')$$,
  'участника без аккаунта можно записать по нику'
);

select throws_ok(
  $$insert into app.kh_queue_settings (id, max_active_queues)
    values (false, 15)$$,
  '23514', null, 'лимит выше 14 отклоняется'
);

select lives_ok(
  $$insert into app.kh_reward_history (queue_key, user_id, game_nickname, issued_by)
    values ('summons', '00000000-0000-0000-0000-000000000126', 'КХНик2', null)$$,
  'выдачу можно сохранить со снимком ника'
);

select lives_ok(
  $query$do $body$ begin
    delete from app.profiles where id = '00000000-0000-0000-0000-000000000126';
    if not exists (
      select 1 from app.kh_reward_history where game_nickname = 'КХНик2'
    ) then
      raise exception 'history row was deleted with its profile';
    end if;
  end $body$;$query$,
  'история выдачи остаётся после удаления профиля'
);

select * from finish();
rollback;
