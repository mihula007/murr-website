# Этап 3. Аккаунт и доступ — план реализации

> **Для исполнителя:** используйте superpowers:executing-plans, задачи выполняются по порядку; шаги отмечаются чекбоксами. Это подробный план этапа 3 из [мастер-плана](2026-11-08-master-plan.md). **Статус: согласован владельцем 08.11.2026 и выполнен; отличия — в [журнале проверки](2026-11-08-stage-3-verification.md).**

**Цель:** регистрация по email и паролю с подтверждением кодом, автоматическая заявка, вход и выход, профиль и аватар, смена и восстановление пароля, роли на сервере, основа аудита и первый администратор. Оболочка этапа 2 подключается к реальной сессии.

**Архитектура.** Вся бизнес-логика — TypeScript в Supabase Edge Functions (Q-26): HTTP-обработчик → сервис (права, правила, аудит, транзакция) → репозитории (единственное место с SQL, Kysely поверх Postgres). Таблицы в схеме `app`, не открытой Data API; GRANT браузерным ролям нет, RLS включён без политик. Браузер использует supabase-js только для Auth и вызова функции `api`. Сценарии — [проект регистрации](../../architecture/registration-flow.md).

**Стек:** React 19, TanStack Router/Query/Form, zod 4 (общие схемы клиента и сервера), Supabase CLI 3 (Postgres 17, Auth, Storage, Mailpit, edge-runtime), Kysely + postgres.js, Vitest, Playwright, pgTAP.

## Решения владельца (08.11.2026)

- Q-26: бизнес-логика только в TypeScript, без функций Postgres/RPC, репозитории над SQL.
- Q-27: ник ≤ 9 символов, уникален с учётом регистра, можно сменить, прежний освобождается.
- Q-28: анкета до кода — во вкладке; после кода — одна идемпотентная операция; при прерывании — «Завершите регистрацию».
- Q-29: одно событие аудита «Регистрация и создание заявки».
- Q-30: сброс пароля кодом из письма.
- Q-31: аватар после регистрации можно заменить или убрать.
- Q-32: первый администратор — однократная закрытая команда владельца.
- Q-33: ссылки «исполнитель» → `SET NULL`, принадлежащее пользователю → удаление, профиль → `auth.users` `ON DELETE RESTRICT`.
- Q-34: аудит изменения профиля с перечнем полей; смена/сброс пароля — без аудита.
- Q-35: сессия в браузере бессрочная до явного выхода или очистки данных сайта.

## Решения исполнителя (можно оспорить при согласовании)

- **Общий код сервера пишется без глобалов Deno** (кроме точек входа `index.ts`) и с голыми импортами пакетов: Deno берёт версии из `supabase/functions/deno.json`, Node/Vitest — из `node_modules`. Поэтому сервисы и репозитории тестируются Vitest на Node по локальной БД, Deno локально и в CI не нужен. Тест проверяет, что версии в `deno.json` и `package.json` совпадают.
- **Одна «толстая» функция `api`** с маршрутами `/<модуль>/<операция>`: меньше холодных стартов и функций. `verify_jwt = false`, JWT проверяет сам обработчик (`auth.getClaims`), так работает и для анонимных операций.
- **Kysely + postgres.js** (`kysely-postgres-js`), подключение `SUPABASE_DB_URL` (пул, `prepare: false`). Если связка не заработает в edge-runtime — запасной вариант драйвер `pg` со встроенным диалектом Kysely; решение фиксируется в задаче 3. Типы таблиц Kysely выводятся из `supabase gen types --schema app` одним вспомогательным типом.
- **zod-контракты** в `supabase/functions/_shared/contracts/` импортируются и сервером, и клиентом (алиас `@contracts`): одинаковая валидация и типы запросов/ответов.
- **Форма регистрации — одна страница, как в прототипе**, сгруппированная по блокам «Аккаунт», «Персонаж», «О себе» (UX-улучшение без смены стиля); TanStack Form.
- **Справочник классов** — 17 классов из прототипа в порядке прототипа, иконки копируются из `prototype/assets/class-icons/` в `src/assets/class-icons/` (прототип не меняется). Иконка «Дру.png» сопоставляется классу «Друид».

## Ограничения

- Прототип только читается. Облачный проект Supabase и Resend не создаются (этап 12).
- Версии новых зависимостей точные (`npm view <пакет> version`), `package-lock.json` коммитится; в `deno.json` — те же точные версии.
- В коммиты попадают только файлы задачи; чужие правки рабочего дерева не трогаются.
- Каждый экран проверяется на 375 и 1240 px и сравнивается с прототипом (вход, регистрация, кабинет).
- Секреты: строка подключения к облачной БД и SMTP-ключ — только в `.env`/Supabase Secrets; локальные ключи стека берутся из `supabase status` во время запуска и не коммитятся.

## Карта файлов

| Путь                                                  | Назначение                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `supabase/config.toml`                                | Auth (подтверждение, OTP 6 цифр, шаблоны, лимиты), SMTP через `env()`, bucket `avatars`, `api` |
| `supabase/templates/{confirmation,recovery}.html`     | Письма с кодом                                                                                 |
| `supabase/migrations/*_stage3_account.sql`            | Схема `app`: классы, профили, заявки, ссылки, аудит                                            |
| `supabase/tests/database/*.test.sql`                  | pgTAP: закрытость таблиц, ограничения                                                          |
| `supabase/functions/deno.json`                        | Импорт-карта Deno с точными версиями                                                           |
| `supabase/functions/api/index.ts`                     | Точка входа и маршрутизация                                                                    |
| `supabase/functions/_shared/db/`                      | Подключение, транзакции, типы БД                                                               |
| `supabase/functions/_shared/http/`                    | Ошибки, ответы, CORS, маршрутизатор                                                            |
| `supabase/functions/_shared/auth/`                    | Проверка JWT, загрузка исполнителя и роли                                                      |
| `supabase/functions/_shared/contracts/`               | zod-схемы и коды ошибок, общие с клиентом                                                      |
| `supabase/functions/_shared/{audit,account,catalog}/` | `service.ts`, `repository.ts`                                                                  |
| `supabase/functions/_shared/storage/`                 | Подписанные ссылки, проверка сигнатуры файла                                                   |
| `scripts/admin-bootstrap.ts`                          | Команда первого администратора                                                                 |
| `scripts/e2e-env.mjs`                                 | `.env.e2e.local` из `supabase status` для сборки e2e                                           |
| `src/lib/api/`                                        | Клиент функции `api`, сопоставление кодов ошибок с текстами                                    |
| `src/features/auth/`                                  | Сессия, `useMe`, черновик регистрации, сжатие аватара                                          |
| `src/features/account/`                               | Экраны: вход, регистрация, код, завершение, сброс, кабинет                                     |
| `src/app/access.tsx`, `src/app/shell/*`               | Роль из сессии, без dev-переключателя                                                          |
| `tests/server/`, `vitest.server.config.ts`            | Тесты сервисов, репозиториев и HTTP                                                            |
| `e2e/auth.spec.ts`, `e2e/mailpit.ts`                  | Браузерные сценарии                                                                            |
| `.github/workflows/ci.yml`                            | Задание с локальным Supabase                                                                   |

---

## Задача 1. Документы этапа

**Файлы:** `docs/architecture/registration-flow.md`, этот план, `docs/requirements/17-open-questions.md`, мастер-план.

- [x] Решения владельца Q-26–Q-34 записаны; проект регистрации и план написаны.
- [x] Коммит проекта: `docs: add stage 3 registration design and plan`; после согласования статус плана меняется на «согласован».

## Задача 2. Локальная конфигурация Supabase

**Файлы:** `supabase/config.toml`, `supabase/templates/*`, `.env.example`, `README.md`, `supabase/README.md`, `tests/supabase-config.test.ts`.

- [x] `[auth]`: `enable_signup = true`, `minimum_password_length = 8`; `[auth.email]`: `enable_confirmations = true`, `otp_length = 6`, `otp_expiry = 3600`, `secure_password_change = false`; локальные лимиты писем повышены для тестов (`[auth.rate_limit] email_sent`), с комментарием, что облачные лимиты настраиваются на этапе 12.
- [x] Шаблоны `confirmation` и `recovery` на русском: код `{{ .Token }}` крупно, без ссылок, в стиле сайта (тёмный фон, золотой акцент, инлайн-стили).
- [x] `[auth.email.smtp]` для Resend: `host`, `port`, `user`, `pass`, `admin_email`, `sender_name` через `env(AUTH_SMTP_*)`; локально выключен. Проверить, принимает ли CLI `env()` для `enabled`; если нет — `enabled = false` и комментарий, как включать. Переменные с описанием — в `.env.example` и README (не `VITE_`, не `SUPABASE_`, т.к. этот префикс CLI использует для переопределения настроек).
- [x] `[storage.buckets.avatars]`: `public = false`, `file_size_limit = "500KiB"`, `allowed_mime_types` JPEG/PNG/WebP.
- [x] `[functions.api]`: `verify_jwt = false`.
- [x] Проверка: `npm run supabase:stop && npm run supabase:start` успешен; письмо `signUp` приходит в Mailpit с шестизначным кодом (ручная проверка curl'ом, записать в журнал).
- [x] Тест конфигурации: в `config.toml` нет реальных значений SMTP (только `env(...)`), bucket закрыт, подтверждение email включено.
- [x] Коммит: `chore: configure local Supabase auth, email codes and avatars bucket`.

## Задача 3. Схема БД (миграция) и pgTAP

**Файлы:** `supabase/migrations/<ts>_stage3_account.sql`, `supabase/tests/database/stage3.test.sql`, `supabase/functions/_shared/db/database.types.ts`, `package.json` (скрипт `supabase:types`, `supabase:test`).

- [x] Схема `app`; `revoke all on schema app from anon, authenticated, public`; RLS включён у каждой таблицы, политик нет.
- [x] `app.character_classes` (`id smallint` identity, `name` unique, `icon` (имя файла), `sort_order`, `is_active`) + 17 строк из прототипа.
- [x] `app.profiles`: `id uuid PK REFERENCES auth.users ON DELETE RESTRICT`; `display_name` (1–12), `game_nickname` (1–9, `UNIQUE`, с учётом регистра), `city` (≤ 100, null), `birth_date date null`, `class_id` FK, `about` (≤ 1200, null), `avatar_path null`, `access_role` CHECK из пяти ролей, `is_primary_admin boolean default false` с частичным уникальным индексом, `joined_on date null`, `created_at`, `updated_at`. CHECK длины — страховка; правила (trim, обязательность при регистрации) — в сервисе.
- [x] `app.join_applications`: статусы из проекта схемы, `applicant_id` FK `ON DELETE CASCADE`, `decided_by` FK `ON DELETE SET NULL` (Q-33), `submitted_at`, `decided_at`, `decision_note`, timestamps; частичный `UNIQUE(applicant_id)` для активных статусов; индекс `(status, submitted_at desc)`.
- [x] `app.application_equipment_links`: FK `ON DELETE CASCADE`, `url` (≤ 500), `position`, `UNIQUE(application_id, position)`, CHECK `position` 0–9.
- [x] `app.audit_log`: `id bigint identity`, `created_at`, `category`, `action`, `summary`, `actor_id` FK `ON DELETE SET NULL` + снимки `actor_role`, `actor_nickname`, `actor_email`; `target_kind`, `target_id`, `target_user_id` FK `ON DELETE SET NULL` + `target_nickname`, `target_email`; `details jsonb` CHECK object; индексы из проекта схемы.
- [x] pgTAP (`supabase test db`): все таблицы `app` с RLS; у `anon`/`authenticated` нет привилегий на таблицы и схему; схема `app` не в Data API (запрос через PostgREST — отдельно в HTTP-тесте); `UNIQUE` ника различает регистр («Ник» и «ник» допустимы, «Ник» дважды — нет); вторая активная заявка отклоняется; удаление `auth.users` с профилем отклоняется.
- [x] `npm run supabase:reset` применяет миграцию с нуля; типы генерируются и коммитятся.
- [x] Коммит: `feat: add account schema closed to the Data API`.

## Задача 4. Серверная основа

**Файлы:** `supabase/functions/deno.json`, `_shared/{db,http,auth,contracts,audit}/`, `supabase/functions/api/index.ts`, `tsconfig.functions.json`, `vitest.server.config.ts`, `tests/server/*`, `package.json`.

- [x] Зависимости (точные версии): `kysely`, `kysely-postgres-js`, `postgres`, `zod` (+ `@supabase/supabase-js` уже есть) в `package.json` и `deno.json`; тест совпадения версий.
- [x] `db`: `createDb(url)`, `withTransaction(db, fn)`; типы Kysely из сгенерированных.
- [x] `http`: `ApiError(code, status)`, коды ошибок из `contracts/errors.ts`, JSON-ответы, CORS (origin из настроек сайта и localhost), маршрутизатор `{ 'account/me': handler }`, единый перехват ошибок без утечки деталей.
- [x] `auth`: из заголовка `Authorization` получить пользователя (`getClaims`), загрузить email/подтверждение и профиль → `Actor = { kind: 'guest' } | { kind: 'user', userId, email, emailConfirmed, profile | null }`; хелперы `requireConfirmedUser`, `requireProfile`, `requireRole(roles)`.
- [x] `audit`: `AuditRepository.insert` + `trimToLatest(1000)`; `AuditService.write(tx, actor, event)` берёт снимки ника/email/роли, проверяет allowlist ключей `details`, внутри `pg_advisory_xact_lock` для порядка вытеснения.
- [x] `api/index.ts`: `Deno.serve` → маршрутизатор; переменные `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY` предоставляет платформа.
- [x] Тесты (`npm run test:server`, требует запущенный Supabase): транзакция откатывает всё при ошибке; аудит хранит ровно 1000 последних при 1005 вставках и при 20 параллельных транзакциях; ключи вне allowlist отклоняются; `Actor` для гостя, неподтверждённого и пользователя без профиля.
- [x] Коммит: `feat: add Edge Function foundation with repositories and audit`.

## Задача 5. Сервис аккаунта и функция `api`

**Файлы:** `_shared/{account,catalog,storage}/`, `_shared/contracts/account.ts`, `api/index.ts`, `tests/server/account*.test.ts`.

Операции:

| Маршрут                         | Кто                          | Что делает                                                      | Аудит                |
| ------------------------------- | ---------------------------- | --------------------------------------------------------------- | -------------------- |
| `catalog/classes`               | все                          | Активные классы                                                 | нет                  |
| `account/check-nickname`        | все                          | Свободен ли ник (с учётом регистра), без резервирования         | нет                  |
| `account/me`                    | вошедший                     | Состояние, профиль, роль, статус заявки, ссылка на аватар (1 ч) | нет                  |
| `account/avatar-upload`         | подтверждённый вошедший      | Подписанная ссылка на загрузку `avatars/<uid>/<uuid>.<ext>`     | нет                  |
| `account/complete-registration` | подтверждённый без профиля   | Профиль `applicant` + заявка + ссылки, идемпотентно             | Q-29, одно событие   |
| `account/update-profile`        | любой с профилем, вкл. чтеца | Поля профиля, замена/удаление аватара, смена ника               | Q-34, перечень полей |

- [x] Проверка файла: объект в папке пользователя, размер ≤ 500 KB, сигнатура JPEG/PNG/WebP по первым байтам; очистка лишних файлов папки после фиксации.
- [x] Ошибки: `nickname_taken`, `email_not_confirmed`, `registration_incomplete`, `already_registered` (не ошибка — возвращается состояние), `avatar_invalid`, `validation_failed` с полями.
- [x] Тесты сервиса (Vitest, локальная БД): матрица «роль × операция» для guest / неподтверждённый / без профиля / applicant / reader / member / officer / admin; идемпотентность и две параллельные регистрации; занятый ник при регистрации и при смене; смена ника освобождает прежний; профиль не меняет `access_role`, `joined_on`, email; аудит без значений полей.
- [x] HTTP-тесты по запущенной `supabase functions serve`: без токена → 401 на закрытых маршрутах; анонимные маршруты работают; таблица `app.profiles` недоступна через PostgREST (`/rest/v1/...` с ключом и JWT пользователя → ошибка).
- [x] Коммит: `feat: add account service with registration and profile operations`.

## Задача 6. Первый администратор

**Файлы:** `scripts/admin-bootstrap.ts`, `_shared/account/bootstrap.ts`, `tests/server/bootstrap.test.ts`, `.env.example` (`ADMIN_DATABASE_URL`), `README.md`.

- [x] Команда `npm run admin:bootstrap -- --email … --nickname … --name … --class …` (Node 24 запускает TS напрямую). Без `ADMIN_DATABASE_URL` использует локальную БД из `supabase status`.
- [x] Сервис: администратора нет, пользователь Auth с email подтверждён, профиля нет → профиль `admin`, `is_primary_admin`, `joined_on = сегодня (МСК)`, без заявки, аудит «Назначен первый администратор». Иначе — понятный отказ без изменений.
- [x] Тесты: успешный запуск, повторный запуск, неподтверждённый email, уже есть профиль.
- [x] Коммит: `feat: add first administrator bootstrap command`.

## Задача 7. Клиент: сессия и доступ

**Файлы:** `src/lib/api/*`, `src/features/auth/*`, `src/app/access.tsx`, `src/app/providers.tsx`, `src/components/route-gate.tsx`, `src/app/shell/*` (удаление `dev-role-switcher.tsx`), `src/lib/supabase/client.ts`, тесты.

- [x] `callApi(route, body)` через `supabase.functions.invoke('api/<route>')`, разбор кода ошибки → русское сообщение; ошибка сети ≠ успех.
- [x] `SessionProvider`: подписка `onAuthStateChange`, очистка кеша Query при выходе и смене пользователя; `useMe()` (Query) только при наличии сессии.
- [x] `AccessProvider` получает роль из `useMe` (`guest`, пока нет профиля); добавляет `status: 'loading' | 'guest' | 'incomplete' | 'ready'`. `RouteGate` при загрузке показывает `LoadingState`. Проп `role` для тестов сохраняется.
- [x] Удалить dev-переключатель и ключ `murr-dev-role`; e2e-проверку артефакта обновить (переключатель и ключ отсутствуют). Демо `/#/dev/unsaved-demo` оставить.
- [x] Без публичной конфигурации Supabase экраны входа показывают «Вход временно недоступен», статический каркас работает.
- [x] Тесты: роль из `me` → меню; выход очищает кеш; `incomplete` → гостевое меню; загрузка → `LoadingState`.
- [x] Коммит: `feat: connect access and navigation to the real session`.

## Задача 8. Экраны входа и регистрации

**Файлы:** `src/features/account/{login,register,verify,complete,reset}-page.tsx`, `src/features/auth/{registration-draft,compress-avatar}.ts`, `src/routes/*`, `src/assets/class-icons/*`, тесты, истории Storybook.

- [x] Маршруты: `/login`, `/register`, `/register/verify`, `/register/complete`, `/reset-password`; `/account` для гостя перенаправляет на `/login`. Кнопки шапки: «Вход» / «Аккаунт»; на главной для гостя — «Вступить в клан».
- [x] Регистрация: поля и подписи как в прототипе (`.card.auth-card` 620 px, `formgrid` в две колонки, одна колонка до 650 px), предпросмотр аватара 72 px, до 10 ссылок снаряжения (вместо файлов — Q-11), подсказка по нику (проверка при уходе с поля), ошибки у полей, кнопка «Создать учётную запись» на всю ширину.
- [x] Сжатие аватара: canvas до 512 px, WebP при поддержке браузером, иначе JPEG; итог ≤ 500 KB, иначе ошибка у поля.
- [x] Код: шесть цифр (`inputmode="numeric"`, `autocomplete="one-time-code"`), «Отправить ещё раз» с таймером, ошибки «Неверный или истёкший код».
- [x] Завершение регистрации: те же поля, кроме email и пароля; подставляет черновик вкладки; аватар заново.
- [x] Сброс пароля: email → код + новый пароль ×2 с переключением видимости.
- [x] `useUnsavedChangesGuard` на регистрации, завершении и сбросе (не мешает переходу после успеха).
- [x] Тесты: валидация (имя 13, ник 10, пароль 7, пустой аватар), черновик без пароля, сжатие (размер и пропорции), перевод на вход при существующем email.
- [x] Коммит: `feat: add sign-in, registration, code and password reset screens`.

## Задача 9. Личный кабинет

**Файлы:** `src/features/account/account-page.tsx`, `profile-form.tsx`, `password-form.tsx`, тесты.

- [x] По прототипу: шапка профиля с аватаром 76 px, ник, роль, статус заявки (тексты прототипа), блок «Личная информация» (раскрывается отдельно) и «Смена пароля» (`details`); чтец видит профиль и смену пароля без статуса заявки (ACC-05).
- [x] Редактирование: предзаполнение, email только для чтения, замена/удаление аватара с предпросмотром, сохранение → инвалидация `me`, тост только после ответа сервера.
- [x] Смена пароля: три поля с «Показать/Скрыть», ошибки у полей (ACC-09), успех очищает и сворачивает (ACC-10).
- [x] Кнопка «Выйти» (ACC-12). `useUnsavedChangesGuard` на обеих формах.
- [x] Тесты: предзаполнение, ошибки пароля, удаление аватара, состояние чтеца.
- [x] Коммит: `feat: add account dashboard with profile and password forms`.

## Задача 10. Браузерные сценарии

**Файлы:** `scripts/e2e-env.mjs`, `e2e/mailpit.ts`, `e2e/db.ts`, `e2e/auth.spec.ts`, `e2e/access.spec.ts`, `playwright.config.ts`, `package.json` (`build:e2e`).

- [x] `build:e2e`: публичные URL и ключ локального стека из `supabase status -o env` → `.env.e2e.local` (игнорируется Git) → `vite build --mode e2e`.
- [x] Хелперы: код из Mailpit API по адресу получателя; повышение роли тестового пользователя прямым SQL к локальной БД (только для тестов).
- [x] Сценарии (desktop + mobile): регистрация → код из Mailpit → главная, кабинет показывает «Ожидает проверки офицера», внутренние разделы закрыты; прерывание после кода (закрыть вкладку) → вход → «Завершите регистрацию» → успех, одна заявка; существующий email → вход; неверный пароль, вход, выход; редактирование профиля и смена ника; смена пароля (старый не подходит); восстановление пароля кодом; меню по ролям после повышения; прямой вызов `api` закрытой операции чужим токеном отклоняется.
- [x] Каркасные сценарии этапа 2 продолжают проходить.
- [x] Коммит: `test: add account and access browser scenarios`.

## Задача 11. CI

**Файлы:** `.github/workflows/ci.yml`.

- [x] Задание `backend`: `supabase start` (Docker на runner), `supabase db reset`, `supabase test db`, `npm run test:server` (с `supabase functions serve` в фоне), `build:e2e`, Playwright. Существующее задание `check` не требует Docker.
- [x] Ключи локального стека берутся из `supabase status` в шаге, в логи не печатаются.
- [x] Коммит: `ci: run database, server and browser tests on local Supabase`.

## Задача 12. Документация

**Файлы:** `AGENTS.md`, `README.md`, `supabase/README.md`, `docs/design-system.md`, `docs/requirements/03-account.md`, `01-roles.md`, `15-admin.md` (статусы), мастер-план.

- [x] AGENTS.md: команды (`test:server`, `supabase:test`, `admin:bootstrap`, `build:e2e`), роль из сессии вместо заглушки, структура `_shared`, правило «БД раньше клиента, изменения совместимы».
- [x] Статусы: реализованные ACC/ACL/ADM — «реализовано»; не «принято».
- [x] Мастер-план: этап 3 завершён, отличия от плана.
- [x] Коммит: `docs: update project notes for stage 3`.

## Задача 13. Итоговая проверка

- [ ] `npm run check`, `npm run supabase:test`, `npm run test:server`, `npm run build:e2e && npm run test:e2e` — зелёные.
- [ ] Ручная проверка на 375 / 768 / 1240 px: все экраны этапа, клавиатура, сравнение с прототипом (`prototype/index.html`: вход, регистрация, кабинет); исправляются только визуальные ошибки и UX.
- [ ] Журнал `docs/superpowers/plans/2026-11-08-stage-3-verification.md`: что проверено, отличия от плана, что не проверено.
- [ ] `git status`: нет посторонних файлов и секретов (`npm run security:check`).

## Аудит действий этапа (ADM-14)

| Действие                          | Аудит | Основание                    |
| --------------------------------- | ----- | ---------------------------- |
| Завершение регистрации и заявка   | Да    | ADM-11, Q-29                 |
| Изменение своего профиля          | Да    | Q-34 (только перечень полей) |
| Назначение первого администратора | Да    | Q-32                         |
| Смена и восстановление пароля     | Нет   | Q-34                         |
| Вход, выход, отправка кода        | Нет   | Не меняют данные приложения  |
| Загрузка аватара без сохранения   | Нет   | Не меняет профиль            |

## Критерии готовности этапа

- Регистрация проходит до создания заявки; прерывание продолжается; повтор не создаёт дубликатов.
- Каждая роль видит своё меню; роль приходит только с сервера; dev-переключатель удалён.
- Прямой вызов операции без прав отклоняется; таблицы недоступны через Data API.
- Первый администратор создаётся закрытой командой; аудит пишется и хранит не более 1000 записей.
- Все формы защищены от потери данных; экраны проверены на desktop и mobile.
- Все проверки задачи 13 проходят; документация и журнал обновлены.

## Риски и допущения

- **Kysely/postgres.js в edge-runtime.** Проверяется в задаче 4 первым шагом; запасной драйвер `pg`.
- **Квоты Free:** каждая страница вызывает функцию; проверить актуальные лимиты вызовов и CPU перед этапом 12.
- **Письма локально:** лимиты Auth повышены только в локальной конфигурации; облачные — этап 12.
- **Поведение `signUp` для существующего email** (пустые identities) и повторного `signUp` неподтверждённого проверяется на локальном стеке; при расхождении с проектом — уточнить в журнале.
- **Docker в CI** увеличивает время задания; при превышении лимита времени — разделить задания.
