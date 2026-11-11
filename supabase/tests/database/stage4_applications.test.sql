-- Схема этапа 4: уведомления и согласованность решения заявки.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select ok(
  (select rowsecurity from pg_tables
    where schemaname = 'app' and tablename = 'user_notifications'),
  'RLS включён у app.user_notifications'
);

select ok(
  not has_table_privilege('anon', 'app.user_notifications', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'app.user_notifications', 'select,insert,update,delete'),
  'anon и authenticated не имеют прав на app.user_notifications'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000041', 'cand@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000042', 'officer@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000041', 'Кандидат', 'Cand', 1, 'applicant'),
  ('00000000-0000-0000-0000-000000000042', 'Офицер', 'Officer', 1, 'officer');

insert into app.join_applications (id, applicant_id, status)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000041', 'pending_officer_review');

select throws_ok(
  $$update app.join_applications set status = 'officer_approved'
    where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '23514', null, 'решённая заявка без decided_at отклоняется'
);

select throws_ok(
  $$update app.join_applications set decided_at = now()
    where id = '00000000-0000-0000-0000-0000000000a1'$$,
  '23514', null, 'активная заявка с decided_at отклоняется'
);

select lives_ok(
  $$update app.join_applications
    set status = 'officer_rejected', decided_at = now(),
      decided_by = '00000000-0000-0000-0000-000000000042'
    where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'решение с временем и исполнителем сохраняется'
);

select lives_ok(
  $$insert into app.user_notifications
    (recipient_id, actor_id, kind, title, target_kind, target_id, source_kind, source_id)
    values ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042',
      'application_rejected', 'Заявка отклонена', 'join_application',
      '00000000-0000-0000-0000-0000000000a1', 'join_application',
      '00000000-0000-0000-0000-0000000000a1')$$,
  'уведомление о решении создаётся'
);

select throws_ok(
  $$insert into app.user_notifications
    (recipient_id, kind, title, source_kind, source_id)
    values ('00000000-0000-0000-0000-000000000041', 'application_rejected',
      'Повтор', 'join_application', '00000000-0000-0000-0000-0000000000a1')$$,
  '23505', null, 'повтор уведомления того же источника отклоняется'
);

select throws_ok(
  $$insert into app.user_notifications
    (recipient_id, kind, title, target_kind, source_kind, source_id)
    values ('00000000-0000-0000-0000-000000000041', 'application_accepted',
      'Без id цели', 'join_application', 'join_application', 'x')$$,
  '23514', null, 'цель задаётся парой kind и id'
);

select throws_ok(
  $$insert into app.user_notifications
    (recipient_id, kind, title, source_kind, source_id)
    values ('00000000-0000-0000-0000-000000000041', 'unknown_kind', 'Т', 's', '1')$$,
  '23514', null, 'неизвестный вид уведомления отклоняется'
);

delete from app.profiles where id = '00000000-0000-0000-0000-000000000042';

select is(
  (select actor_id from app.user_notifications
    where recipient_id = '00000000-0000-0000-0000-000000000041'),
  null,
  'удаление инициатора очищает actor_id, уведомление остаётся (Q-33)'
);

delete from app.profiles where id = '00000000-0000-0000-0000-000000000041';

select is(
  (select count(*)::int from app.user_notifications
    where recipient_id = '00000000-0000-0000-0000-000000000041'),
  0,
  'уведомления удаляются вместе с получателем (Q-33)'
);

select * from finish();
rollback;
