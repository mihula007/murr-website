-- NTF-14: допустимый вид системного напоминания.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values ('00000000-0000-0000-0000-0000000022a1', 'a22@example.test', now(),
  'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values ('00000000-0000-0000-0000-0000000022a1', 'А', 'Alpha22', 1, 'member');

select lives_ok(
  $$insert into app.user_notifications
      (recipient_id, kind, title, body, target_kind, target_id, source_kind, source_id)
    values ('00000000-0000-0000-0000-0000000022a1', 'messenger_reminder',
      'Подключите мессенджер', 'Привяжите канал', 'messengers', 'self',
      'system', '00000000-0000-0000-0000-0000000022a1')$$,
  'системное напоминание принимается'
);

select throws_ok(
  $$insert into app.user_notifications
      (recipient_id, kind, title, source_kind, source_id)
    values ('00000000-0000-0000-0000-0000000022a1', 'unknown',
      'Неизвестное', 'test', 'bad')$$,
  '23514', null, 'неизвестный вид уведомления отклоняется'
);

select * from finish();
rollback;
