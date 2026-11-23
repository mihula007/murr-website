-- Таблица и исходные значения для истории характеристик.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

select has_table('app', 'character_stat_history', 'история характеристик существует');

select ok(
  (select rowsecurity from pg_tables
    where schemaname = 'app' and tablename = 'character_stat_history'),
  'RLS включён у истории характеристик'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as r(role)
    where has_table_privilege(r.role, 'app.character_stat_history', 'select,insert,update,delete')
  ),
  'браузерные роли не имеют доступа к истории характеристик'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-0000000021a1', 'dynamics21@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (
  id, display_name, game_nickname, class_id, access_role, pa, pz, bu, hp, bd
)
values (
  '00000000-0000-0000-0000-0000000021a1', 'Динамика', 'Dyn21', 1,
  'member', 100, 200, 30, 40000, 5000
);

select throws_ok(
  $$insert into app.character_stat_history (user_id, field, value)
    values ('00000000-0000-0000-0000-0000000021a1', 'source', 1)$$,
  '23514', null, 'разрешены только пять числовых характеристик'
);

select throws_ok(
  $$insert into app.character_stat_history (user_id, field, value, kind)
    values ('00000000-0000-0000-0000-0000000021a1', 'pa', 1, 'import')$$,
  '23514', null, 'тип записи ограничен baseline, ручным изменением и checkpoint'
);

select lives_ok(
  $$insert into app.character_stat_history (user_id, field, value, recorded_at, kind)
    values ('00000000-0000-0000-0000-0000000021a1', 'pa', 100,
      '2026-11-27T20:59:00Z', 'checkpoint')$$,
  'пятничную контрольную точку можно сохранить'
);

select throws_ok(
  $$insert into app.character_stat_history (user_id, field, value, recorded_at, kind)
    values ('00000000-0000-0000-0000-0000000021a1', 'pa', 100,
      '2026-11-27T20:59:00Z', 'checkpoint')$$,
  '23505', null, 'повторный checkpoint за ту же дату не дублируется'
);

select is(
  (select schedule::text from cron.job
    where jobname = 'roster-dynamics-checkpoint-weekly'),
  '59 20 * * 5',
  'checkpoint запускается в пятницу в 23:59 по Москве'
);

select lives_ok(
  $$insert into app.character_stat_history (user_id, field, value, kind)
    values ('00000000-0000-0000-0000-0000000021a1', 'pz', null, 'change')$$,
  'очищенное ручное значение можно сохранить как null'
);

delete from app.profiles where id = '00000000-0000-0000-0000-0000000021a1';

select is(
  (select count(*) from app.character_stat_history
    where user_id = '00000000-0000-0000-0000-0000000021a1'),
  0::bigint,
  'история удаляется вместе с профилем'
);

select * from finish();
rollback;
