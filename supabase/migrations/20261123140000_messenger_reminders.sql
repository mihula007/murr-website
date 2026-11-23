-- NTF-14: персональное напоминание о привязке мессенджера.
alter table app.user_notifications
  drop constraint user_notifications_kind_check;
alter table app.user_notifications
  add constraint user_notifications_kind_check check (kind in (
    'application_accepted', 'application_rejected',
    'discussion_mention', 'discussion_reply',
    'group_added', 'group_leader', 'role_changed',
    'messenger_reminder'
  ));
