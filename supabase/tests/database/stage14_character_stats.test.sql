begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'app' and table_name = 'profiles'
      and column_name in (
        'pa', 'pz', 'bu', 'hp', 'bd', 'character_stats_source'
      )),
  6,
  'пять характеристик и источник добавлены к профилю'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'app' and table_name = 'profiles'
      and column_name in ('pa', 'pz', 'bu', 'hp', 'bd')
      and data_type = 'numeric' and numeric_precision = 18 and numeric_scale = 3),
  5,
  'характеристики хранятся с точностью numeric(18,3)'
);

select is(
  (select data_type from information_schema.columns
    where table_schema = 'app' and table_name = 'profiles'
      and column_name = 'character_stats_source'),
  'text',
  'источник хранится как текст'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'app' and table_name = 'profiles'
      and column_name in (
        'pa', 'pz', 'bu', 'hp', 'bd', 'character_stats_source'
      ) and is_nullable = 'YES' and column_default is null),
  6,
  'все шесть полей допускают null и не получают значения по умолчанию'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-000000009901', 'stats@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values ('00000000-0000-0000-0000-000000009901', 'Тест', 'Статы', 1, 'member');

select is(
  (select count(*)::int from app.profiles
    where id = '00000000-0000-0000-0000-000000009901'
      and pa is null and pz is null and bu is null and hp is null and bd is null
      and character_stats_source is null),
  1,
  'новый профиль без значений сохраняет все шесть полей пустыми'
);

update app.profiles set pa = 125500.250
where id = '00000000-0000-0000-0000-000000009901';

select is(
  (select pa from app.profiles where id = '00000000-0000-0000-0000-000000009901'),
  125500.250::numeric,
  'точное числовое значение сохраняется'
);

select throws_ok(
  $$update app.profiles set pa = -0.001
    where id = '00000000-0000-0000-0000-000000009901'$$,
  '23514', null, 'отрицательное значение запрещено'
);

select throws_ok(
  $$update app.profiles set pa = 1000000000000000.000
    where id = '00000000-0000-0000-0000-000000009901'$$,
  '22003', null, 'значение за пределом numeric(18,3) отклоняется'
);

select lives_ok(
  $$update app.profiles set character_stats_source = repeat('я', 160)
    where id = '00000000-0000-0000-0000-000000009901'$$,
  'источник длиной 160 символов сохраняется'
);

select throws_ok(
  $$update app.profiles set character_stats_source = repeat('я', 161)
    where id = '00000000-0000-0000-0000-000000009901'$$,
  '23514', null, 'источник длиннее 160 символов отклоняется'
);

select * from finish();
rollback;
