# Интеграция ВКонтакте: технический проект

Требования — [21-vk.md](../requirements/21-vk.md), решение — Q-100. Образец — [MAX](max-integration.md) и [Telegram](telegram-integration.md); ниже только отличия.

## Решения

- Модуль `_shared/vk/` по устройству `_shared/max/`; общие части — `_shared/messenger/` (код привязки, данные кнопок, синхронизация ответа).
- Вебхук — Callback API сообщества, маршрут `vk/webhook`. Callback API ждёт ответ простым текстом `ok` (иначе повторяет событие), а на событие `confirmation` — строку подтверждения. Обработчик HTTP `api` отдаёт `Response`, если маршрут вернул его.
- Строка подтверждения не хранится: на `confirmation` функция вызывает `groups.getCallbackConfirmationCode`.
- Сообщения бота — простой текст (VK-06): Bot API ВКонтакте не поддерживает HTML.

## API ВКонтакте (по `VKCOM/vk-api-schema`, 11.2026)

| Что              | Как                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Запрос           | `POST https://api.vk.com/method/<метод>`, форма `application/x-www-form-urlencoded`, `access_token` и `v=5.199` в теле (не в адресе). Ответ `{ response }` или `{ error: { error_code } }`.    |
| Отправка         | `messages.send` с `peer_ids=<id>`, `random_id`, `message`, `keyboard` (JSON), `dont_parse_links=1`; ответ — массив `{ peer_id, message_id, conversation_message_id, error? }`.                 |
| Кнопки           | `{ inline: true, buttons: [[{ action: { type: 'callback', label, payload } }]] }`; `payload` — JSON-строка `{"d":"a:<eventId>:y"}` (≤ 255 символов).                                           |
| Правка           | `messages.edit` с `peer_id`, `cmid` (`conversation_message_id`), `message`, `keyboard`; без кнопок — `{"inline":true,"buttons":[]}`. 909 — сообщение слишком старое, 920 — нельзя править.     |
| Нажатие          | Событие `message_event`: `user_id`, `peer_id`, `event_id`, `payload`, `conversation_message_id`. Ответ — `messages.sendMessageEventAnswer` с `event_data` `{"type":"show_snackbar","text":…}`. |
| Привязка         | Ссылка `https://vk.me/<сообщество>?ref=<код>`; первое сообщение пользователя приходит событием `message_new` с `message.ref`.                                                                  |
| Запрет сообщений | `message_deny` → отметка; `message_allow` → снятие. Ошибки отправки 900, 901, 902 — `blocked`. 6 и 9 — одна пауза 1 с и повтор.                                                                |
| Имя              | `users.get` с `fields=screen_name`.                                                                                                                                                            |
| Регистрация      | `groups.addCallbackServer` (`url`, `title`, `secret_key` ≤ 50), `groups.setCallbackSettings` (`api_version`, `message_new`, `message_event`, `message_allow`, `message_deny`).                 |

Темп отправки — 15 сообщений за секунду (лимит ключа сообщества — 20 запросов в секунду).

**Проверить на сообществе** (документация dev.vk.com недоступна из среды разработки, проект сделан по схеме API):

- Приходит ли `ref` только с первым сообщением после перехода по ссылке и при нажатии «Начать».
- `payload` в `message_event`: схема говорит «строка», клиент принимает и строку, и объект.
- Сколько времени ВКонтакте разрешает править сообщения с клавиатурой (VK-08).

## Конфигурация

| Переменная           | Назначение                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| `VK_BOT_TOKEN`       | Секрет. Ключ доступа сообщества с правом «сообщения сообщества».                  |
| `VK_GROUP_ID`        | Числовой ID сообщества.                                                           |
| `VK_GROUP_NAME`      | Необязательно: короткий адрес для ссылки `vk.me/<адрес>`; иначе `vk.me/club<ID>`. |
| `VK_CALLBACK_SECRET` | Секрет. «Секретный ключ» Callback API (≤ 50 символов), приходит полем `secret`.   |
| `VK_API_BASE`        | Только тесты: фальшивый API вместо `https://api.vk.com/method`.                   |

Без `VK_BOT_TOKEN`, `VK_GROUP_ID` и `VK_CALLBACK_SECRET` — `vk_unavailable` (503).

## Данные

Миграция `stage15_vk`: `vk_links` (`vk_user_id bigint unique`, `chat_id bigint` — `peer_id` диалога), `vk_link_codes`, `vk_announcements`, `vk_event_messages` (`chat_id`, `message_id` — `conversation_message_id`).

## Операции `api`

`vk/status`, `vk/link-start`, `vk/unlink`, `vk/webhook`. `broadcasts/recipients` и `broadcasts/send` получают канал `vk`.

## Регистрация вебхука

`npm run vk:webhook -- --functions https://<ref>.supabase.co/functions/v1` добавляет сервер Callback API и включает события `message_new`, `message_event`, `message_allow`, `message_deny`. Ключ — из `.env`, не печатается.
