-- Картинки в анонсах постоянных еженедельных событий (TGM-27, MAX-13,
-- VK-10, Q-114). `media` — ссылка на картинку отправленного сообщения в
-- формате мессенджера, чтобы перерисовка её сохраняла: Telegram — `file_id`,
-- MAX — токен загрузки, ВКонтакте — вложение `photo<owner>_<id>_<key>`.
-- null — сообщение без картинки (как все сообщения до этой миграции).
alter table app.telegram_event_messages
  add column media text check (char_length(media) between 1 and 500);
alter table app.max_event_messages
  add column media text check (char_length(media) between 1 and 500);
alter table app.vk_event_messages
  add column media text check (char_length(media) between 1 and 500);
