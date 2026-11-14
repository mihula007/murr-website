# Этап 13. Telegram: привязка и анонсы — план реализации

> **Для исполнителя:** используйте superpowers:executing-plans, задачи выполняются по порядку; шаги отмечаются чекбоксами. Это подробный план этапа 13 из [мастер-плана](2026-11-08-master-plan.md). **Статус: проект, ждёт согласования владельцем.** Решения до старта — Q-76–Q-95 (14.11.2026). Этап выполняется до этапа 12 (запуск), который затем включает настройку рабочего бота.

**Цель:** член, офицер и администратор привязывают Telegram в кабинете; офицер и администратор отправляют из «Рассылки» анонсы в Telegram — анонс события с кнопками «Приду», «Не приду», «50/50» и «Изменить решение», отдельный анонс — только текстом; ответ кнопкой равен ответу на сайте, ответ на сайте обновляет сообщение.

**Архитектура.** Как на этапах 3–11: обработчик функции `api` → сервисы `telegram`, `broadcasts`, `events` → репозитории (Kysely). Вебхук Telegram — маршрут той же функции `api`, проверка — секретным заголовком. Bot API — через `fetch` без библиотеки бота (лёгкий старт функции). Новых Edge Functions нет. Новые переменные окружения — `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `SITE_URL`, `TELEGRAM_API_BASE` (тесты); `TELEGRAM_BOT_TOKEN` уже есть в шаблоне. Новая npm-зависимость — `cloudflared` (devDependencies, Q-95). Клиент — новый модуль `src/features/telegram/`, изменённые `src/features/broadcast/` и `src/features/account/`. Подробности — [технический проект](../../architecture/telegram-integration.md).

**Требования:** TGM-01–26, BRC-01, BRC-05, BRC-07, BRC-08/09 (отмена), BRC-13, EVT-04, EVT-05, Q-22, Q-43, Q-45, Q-76–Q-95; приёмка TGM 1–9, E2E-08. Не входят: ВКонтакте и MAX, другие доставки в Telegram (Q-86), регистрация рабочего бота и вебхука облака (этап 12).

## Решения владельца (14.11.2026)

- **Q-76.** «Изменить решение» как на сайте: показывает три кнопки, ответ не меняется до нового выбора; подписи — «Приду», «Не приду», «50/50».
- **Q-77.** Ответ на сайте обновляет активное сообщение события в Telegram.
- **Q-78.** Новый анонс того же события снимает с прежнего сообщения кнопки и строку ответа.
- **Q-79.** Изменение события не меняет отправленных сообщений; офицер отправляет новый анонс.
- **Q-80.** Текст редактируется только до отправки; истории анонсов на сайте нет.
- **Q-81.** Отправляют офицеры и администраторы.
- **Q-82.** Отправка — на странице «Рассылка»; черновики и шаблоны остаются; ВКонтакте и MAX недоступны; вложения убираются полностью.
- **Q-83.** Получатели — на момент отправки; «Отвязать» в кабинете; заблокировавший бота помечается неактивным.
- **Q-84.** После отправки — только toast, без статусов доставки.
- **Q-85.** Одна запись аудита на отправку.
- **Q-86.** Привязка и анонсы — весь объём Telegram.
- **Q-87, Q-95.** Локально — отдельный бот и туннель `cloudflared`.
- **Q-88.** Привязка — член, офицер, администратор; при переходе в чтецы связь хранится, но не используется.
- **Q-89.** Код привязки одноразовый, 15 минут; один Telegram ↔ один аккаунт.
- **Q-90.** Формат: тема жирным, затем текст; ответы бота на прочие сообщения; пояснение «бот остановлен» в кабинете.
- **Q-91.** Текст анонса, черновика и шаблона ≤ 3800 символов.
- **Q-92.** Отказ без получателей и для закрытого или начавшегося события.
- **Q-93.** После начала события кнопки снимаются только при нажатии.
- **Q-94.** Привязка и отвязка не пишутся в аудит.

## Решения исполнителя (можно оспорить при согласовании)

### Сервер

- **Шлюз Bot API** (`telegram/gateway.ts`): `sendMessage`, `editMessageText`, `editMessageReplyMarkup`, `answerCallbackQuery`, `setWebhook`, `deleteWebhook`. Результат — размеченный тип `ok | blocked | not_modified | gone | failed`, исключения наружу не выходят. 429 — одна пауза на `retry_after` (не дольше 5 с) и повтор. URL с токеном и тело ответа с токеном в лог не попадают: логируются метод и код ошибки Telegram. Таймаут запроса — 10 с.
- **`deps.telegram: TelegramGateway | null`.** Без `TELEGRAM_BOT_TOKEN` — `null`: `telegram/link-start`, `broadcasts/recipients`, `broadcasts/send` отвечают `telegram_unavailable` (503), `telegram/status` — `{ configured: false }`, вебхук — 404.
- **`deps.background(task)`** — фоновая задача после ответа. В `api/index.ts` — `EdgeRuntime.waitUntil`, в тестах Node — сбор обещаний, которые тест дожидается (`support.ts`). Общий код глобалов Deno не использует.
- **Общий ответ на событие.** Тело `respondToEvent` выносится в `saveAnswer(deps, viewer, eventId, answer)`; сайт и кнопка вызывают его, поэтому Q-43, роли и блокировка `FOR SHARE` одни. После коммита `events/respond` ставит `deps.background(syncEventMessage(...))` (TGM-21).
- **Код привязки** — 32 случайных байта в base64url (43 символа, допустимо для `start`), в БД — SHA-256 hex. `link-start` заменяет прежний код пользователя (`UNIQUE user_id`, upsert). Вебхук `/start <код>` в одной транзакции: блокирует строку кода `FOR UPDATE`, проверяет срок, удаляет код, upsert связи по `user_id`; чужой `telegram_user_id` ловит `UNIQUE` → ответ бота «Этот Telegram уже привязан к другому аккаунту», связь не меняется (TGM-04).
- **Вебхук.** Сверка `X-Telegram-Bot-Api-Secret-Token` за постоянное время; неверный — 404 (не раскрываем маршрут). Апдейт разбирается zod-схемой подмножества (`message.text`, `message.from`, `message.chat.type = private`, `callback_query`); прочее — 200 без действий. Сообщения не из личного чата игнорируются. Любая внутренняя ошибка после проверки секрета — лог и 200, чтобы Telegram не повторял апдейт. Username и имя связи обновляются при каждом апдейте от привязанного пользователя (TGM-05), `blocked_at` снимается при любом его сообщении (TGM-08).
- **Отправка.** Порядок — по [проекту](../../architecture/telegram-integration.md), раздел «Отправка анонса»: проверки → получатели → строка анонса события → пул до 20 запросов, темп ≤ 25 сообщений в секунду → на каждого успешного получателя короткая транзакция замены активного сообщения → перерисовка прежнего сообщения без кнопок → `blocked_at` для 403 → одна запись аудита `broadcasts/sent` (категория `broadcasts`). Сетевые вызовы — вне транзакций. Получатели — внутренние роли с `blocked_at is null`; число получателей кнопки подтверждения и отправки считает один запрос репозитория.
- **Повторная отправка.** Сервер не защищает от двойной отправки одного текста: подтверждение и блокировка кнопки на время запроса (предложение агента, не подтверждено владельцем).
- **Нажатие кнопки.** `callback_data`: `a:<eventId>:<y|m|n>` и `c:<eventId>`. Проверки по порядку: связь по `from.id` → активное сообщение `(eventId, userId)` совпадает с `chat_id` и `message_id` → `loadActor` → `saveAnswer` (для `a:`) или проверка роли и состояния события (для `c:`). Тексты отказов — каталог `telegram/messages.ts`. Отказ снимает кнопки сообщения; `forbidden` по роли — тоже (TGM-10). Всегда `answerCallbackQuery`.
- **Ошибки.** Новый код `telegram_unavailable` (503) в `contracts/errors.ts` и сообщение в `src/lib/errors.ts`. Отказы отправки — `state_conflict` с `reason`: `no_recipients`, `started`, `closed` (Q-92).

### Клиент

- **Кабинет** — карточка `TelegramLinkCard` из `src/features/telegram/` под профилем, только для внутренних ролей. Состояния: не подключён на сервере (пояснение, без кнопок) → не привязан («Привязать Telegram») → ссылка готова (кнопка-ссылка «Открыть бота» `<a target="_blank" rel="noopener">`, подсказка «нажмите «Запустить» в Telegram», «Получить новую ссылку») → привязан (@username или имя, «Отвязать» через `ConfirmActionDialog`) → бот остановлен (пояснение). `telegram/status` с `refetchOnWindowFocus: true`, запись — `useMutation`, кеш — в `onSuccess`.
- **Рассылка.** Убираются поле файлов, `files.ts`, проверки и тексты BRC-08/09. Каналы: Telegram выбран; ВКонтакте и MAX — недоступные флажки «не подключено». Плашка связанного события для `source.kind === 'event'` с «Снять связь» (существующий `clearSource`): «Анонс события: придёт с кнопками ответа». Кнопка «Отправить в Telegram» доступна при валидной форме и выбранном Telegram: `broadcasts/recipients` → `ConfirmActionDialog` «Отправить N получателям?» → `broadcasts/send` → toast «Отправлено в Telegram: N» (неудачи — «, не доставлено: M») → форма очищается без вопроса о несохранённых изменениях (`ignoreBlocker`). Счётчик символов и лимит 3800 — общая схема.
- **Сброс кеша.** Отправка не меняет данных сайта; кеш не сбрасывается. `events/respond` клиента не меняется.

### Локальная разработка

- `npm run telegram:dev` (`scripts/telegram-dev.ts`): быстрый туннель `cloudflared` к `127.0.0.1:54321` → `setWebhook` (`/functions/v1/api/telegram/webhook`, `secret_token`, `allowed_updates: ["message", "callback_query"]`, `drop_pending_updates: true`) → печать адреса без токена → по Ctrl+C `deleteWebhook` и остановка туннеля. Переменные — из `.env` (`node --env-file-if-exists=.env`).
- `npm run telegram:webhook -- --url <адрес функции>` — однократная регистрация вебхука облака (этап 12).
- README: создание тестового бота в BotFather, какие переменные заполнить, запуск `supabase:functions` + `telegram:dev`.

## Отличия при реализации

Заполняется по ходу выполнения.

## Списки этапа

Новых списков нет: `broadcasts/recipients` возвращает число, а не массив; получатели внутри `broadcasts/send` — участники клана (исключение Q-48, порог `MEMBER_LIST_LIMIT`). Реестр [списков](../../architecture/lists.md) не меняется.

## Операции функции `api`

| Маршрут                                              | Кто                    | Что делает                                               | Аудит                  |
| ---------------------------------------------------- | ---------------------- | -------------------------------------------------------- | ---------------------- |
| `telegram/status`                                    | member, officer, admin | `{ configured, linked, username, displayName, blocked }` | нет (Q-94)             |
| `telegram/link-start`                                | member, officer, admin | Новый код, `{ url }`                                     | нет (Q-94)             |
| `telegram/unlink`                                    | member, officer, admin | Удаляет связь и код                                      | нет (Q-94)             |
| `telegram/webhook`                                   | Telegram (секрет)      | `/start`, прочие сообщения, нажатия кнопок               | нет (Q-45)             |
| `broadcasts/recipients`                              | officer, admin         | `{ count }`                                              | нет                    |
| `broadcasts/send`                                    | officer, admin         | `{ subject, body, eventId? }` → `{ sent, failed }`       | да, одна запись (Q-85) |
| `events/respond` (изменение)                         | member, officer, admin | После коммита — фоновое обновление сообщения в Telegram  | нет                    |
| `broadcasts/save-draft` (изменение), `save-template` | officer, admin         | Без вложений, текст ≤ 3800                               | как было               |

## Карта файлов

| Путь                                                                                                           | Назначение                                                                  |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_stage13_telegram.sql`                                                                | 4 таблицы Telegram; `broadcast_drafts` без `attachments`; лимит текста 3800 |
| `supabase/functions/_shared/contracts/telegram.ts`                                                             | Ответы `status`, `link-start`; схема `send`                                 |
| `supabase/functions/_shared/contracts/broadcasts.ts`, `errors.ts`                                              | Без вложений, `body` ≤ 3800; `telegram_unavailable`                         |
| `supabase/functions/_shared/telegram/gateway.ts`                                                               | Bot API через `fetch`                                                       |
| `supabase/functions/_shared/telegram/render.ts`, `callback-data.ts`, `messages.ts`                             | Текст, клавиатуры, данные кнопок, тексты бота                               |
| `supabase/functions/_shared/telegram/repository.ts`, `service.ts`                                              | Привязка, вебхук, отправка, синхронизация                                   |
| `supabase/functions/_shared/events/service.ts`                                                                 | `saveAnswer`, фоновая синхронизация                                         |
| `supabase/functions/_shared/broadcasts/service.ts`, `repository.ts`                                            | `recipients`, `send`, черновики без вложений                                |
| `supabase/functions/_shared/app.ts`, `api/index.ts`                                                            | Маршруты, `deps.telegram`, `deps.background`, переменные                    |
| `supabase/tests/database/stage13_telegram.test.sql`                                                            | pgTAP: нет GRANT, `UNIQUE`, FK и каскады                                    |
| `tests/server/telegram.test.ts`, `broadcasts.test.ts`, `events.test.ts`, `user-deletion.test.ts`, `support.ts` | Фальшивый шлюз, матрица ролей, вебхук, удаление                             |
| `tests/telegram-render.test.ts`, `tests/check-secrets.test.ts`                                                 | Vitest: рендер и данные кнопок; новый шаблон токена в сканере               |
| `scripts/check-secrets.ts`                                                                                     | Шаблон токена бота Telegram                                                 |
| `scripts/telegram-dev.ts`, `scripts/telegram-webhook.ts`                                                       | Туннель и регистрация вебхука                                               |
| `src/features/telegram/*`                                                                                      | `api.ts`, `query-keys.ts`, `telegram-link-card.tsx`                         |
| `src/features/account/account-page.tsx`                                                                        | Карточка Telegram                                                           |
| `src/features/broadcast/*`                                                                                     | Без файлов; каналы; плашка события; отправка                                |
| `src/lib/errors.ts`                                                                                            | Сообщение `telegram_unavailable`                                            |
| `tests/broadcast.test.tsx`, `tests/telegram-link-card.test.tsx`                                                | Vitest                                                                      |
| `e2e/fake-telegram.ts`, `e2e/telegram.spec.ts`, `e2e/broadcast.spec.ts`                                        | Фальшивый Bot API, E2E-08, правка E2E-07                                    |
| `.env.example`, `README.md`, `AGENTS.md`, `package.json`                                                       | Переменные, запуск, решения, `cloudflared`, скрипты                         |

## Задачи

### 0. Проверка платформы (до кода)

- [ ] Актуальные лимиты Edge Functions Free: время запроса, CPU, вызовы в месяц — оценка отправки 200 сообщений и нажатий. Если отправка не укладывается — остановиться и согласовать (разбиение на части).
- [ ] Локально: `EdgeRuntime.waitUntil` в `supabase functions serve` выполняет задачу после ответа; функция в Docker достигает фальшивого Bot API на хосте (`host.docker.internal`); маршрут `/functions/v1/api/telegram/webhook` доходит до обработчика без JWT.
- [ ] `cloudflared`: npm-пакет ставится на macOS владельца, быстрый туннель без аккаунта принимает POST от Telegram. Версия — точная, причина — в AGENTS.md (Q-95).
- [ ] Bot API: лимит `start` (64 символа, `A-Za-z0-9_-`), `callback_data` (64 байта), длина сообщения (4096), поведение `editMessageText` для старых сообщений личного чата, ответ на заблокированного бота (403) — сверка по актуальной документации; расхождения — в проект.
- [ ] Владелец создаёт тестового бота и заполняет `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`) — исполнитель значений не видит и не печатает.

### 1. Схема

- [ ] Миграция: `telegram_links`, `telegram_link_codes`, `telegram_announcements`, `telegram_event_messages` (по проекту); `broadcast_drafts` без `attachments`; `CHECK` текста черновиков и шаблонов 1–3800; RLS без политик, `REVOKE`.
- [ ] `npm run supabase:reset`, `npm run supabase:types`; pgTAP: нет GRANT, `UNIQUE telegram_user_id`, `UNIQUE code_hash`, каскады от профиля и события, `RESTRICT` не появился.
- [ ] Коммит `feat: add telegram schema`.

### 2. Шлюз, рендер и сканер секретов

- [ ] `gateway.ts`, `render.ts`, `callback-data.ts`, `messages.ts`; `deps.telegram`, `deps.background`, переменные в `api/index.ts`; `telegram_unavailable`.
- [ ] Шаблон токена бота (`\d{8,10}:[A-Za-z0-9_-]{35}`) в `scripts/check-secrets.ts` с тестом.
- [ ] Vitest: экранирование HTML, тема жирным, строка ответа, обрезки нет — длинный текст отклоняет схема; данные кнопок ≤ 64 байт, чужой формат не разбирается; шлюз: 403 → `blocked`, 429 → повтор, токен не попадает в текст ошибки.
- [ ] Коммит `feat: add telegram bot api gateway and rendering`.

### 3. Привязка и вебхук

- [ ] `telegram/status`, `link-start`, `unlink`, `webhook` (`/start <код>`, `/start`, прочие сообщения).
- [ ] Тесты: каждая роль (гость, кандидат, чтец — `forbidden`); без токена — `telegram_unavailable`; код: успех, повтор, просрочен, чужой Telegram уже привязан, перепривязка своего, гонка двух кодов одного Telegram; неверный секрет — 404; не личный чат игнорируется; username обновляется, `blocked_at` снимается; ответы бота по тексту из `messages.ts`.
- [ ] Коммит `feat: add telegram account linking`.

### 4. Анонсы и кнопки

- [ ] `saveAnswer` в `events/service.ts` без изменения поведения сайта (существующие тесты событий проходят); `broadcasts/recipients`, `broadcasts/send`; нажатия `a:` и `c:`; синхронизация после `events/respond`.
- [ ] Тесты: отправка — только офицер и администратор; получатели (член, офицер, администратор с активной связью; чтец, кандидат, заблокированный бот, без связи — нет); отказы `no_recipients`, `started`, `closed`, событие не найдено; ответившему — строка ответа и «Изменить решение»; второй анонс того же события перерисовывает прежнее сообщение без кнопок и заменяет активное; 403 → `blocked_at`; одна запись аудита с числами; отдельный анонс без кнопок и без строк в БД.
- [ ] Тесты нажатий: ответ сохраняется как с сайта; повтор того же ответа; «Изменить решение» не меняет ответ; неактивное сообщение, чужое событие в данных кнопки, непривязанный, чтец, начавшееся, закрытое и удалённое событие → пояснение и снятие кнопок; ответ на сайте → фоновая перерисовка, сбой шлюза не ломает ответ.
- [ ] `user-deletion.test.ts`: связь, код и активные сообщения удаляются с пользователем.
- [ ] Коммит `feat: add telegram announcements and answer buttons`.

### 5. Интерфейс

- [ ] `src/features/telegram/` и карточка в кабинете; правки «Рассылки» по разделу «Клиент».
- [ ] Vitest: состояния карточки; ссылка «Открыть бота» — обычный `<a>`; отвязка через подтверждение; «Рассылка» без поля файлов; ВКонтакте и MAX недоступны; плашка события и «Снять связь»; подтверждение с числом получателей; toast после отправки; ошибка `telegram_unavailable` — понятное сообщение.
- [ ] Storybook — только если появятся компоненты в `src/components/ui/` или `states/` (не ожидается).
- [ ] Проверка в браузере на 375 и 1240 px против прототипа: кабинет и «Рассылка».
- [ ] Коммит `feat: add telegram linking card and broadcast sending`.

### 6. Локальная разработка и ручная проверка

- [ ] `cloudflared` в devDependencies (точная версия), `scripts/telegram-dev.ts`, `scripts/telegram-webhook.ts`, скрипты в `package.json`; `.env.example` с пояснениями новых переменных.
- [ ] Ручная проверка с тестовым ботом владельца: приёмка TGM 1–9 на телефоне в настоящем Telegram. Итог — в журнал проверки.
- [ ] Коммит `feat: add telegram local tunnel tooling`.

### 7. Сценарии и документация

- [ ] `e2e/fake-telegram.ts` — HTTP-сервер, принимающий вызовы Bot API и отдающий их тесту; сборка e2e направляет `TELEGRAM_API_BASE` на него.
- [ ] Playwright desktop и mobile: E2E-08 (привязка через апдейт `/start` → кабинет показывает привязку → офицер отправляет анонс события → нажатие кнопки апдейтом → ответ на карточке события → смена ответа на сайте → вызов `editMessageText`); E2E-07 без файлов.
- [ ] `npm run check`, `npm run test:server`, `npm run supabase:test`, `npm run test:e2e`.
- [ ] Статусы TGM и BRC; `AGENTS.md` (этап 13, модуль `telegram`, `cloudflared` и причина, переменные, команды); README; журнал `2026-11-14-stage-13-verification.md`; статус этапа в мастер-плане.
- [ ] Коммит `test: add telegram scenarios and stage 13 notes`.

## Готово когда

E2E-08 и приёмка TGM проходят на desktop и mobile (с фальшивым Bot API) и вручную в настоящем Telegram с тестовым ботом; прямые вызовы новых операций чужой ролью и вебхук без секрета отклоняются; сбой Telegram не ломает ответ на сайте; удаление пользователя удаляет его связь и сообщения; `npm run check`, серверные тесты и pgTAP проходят; секреты не попали в Git, логи и `dist/`.
