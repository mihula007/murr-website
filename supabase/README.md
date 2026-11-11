# Основа backend

Backend работает в Supabase Free: Postgres, Auth и Edge Functions. Собственный
Node.js-сервер не требуется. В репозитории пока нет прикладных таблиц или
обработчиков.

По решению владельца (Q-26) вся бизнес-логика — TypeScript в Edge Functions.
Функции Postgres/RPC, триггеры и RLS-политики с правилами не пишутся; доступ к
данным — через репозитории над SQL. Подробности — раздел «Серверная логика»
в корневом `AGENTS.md`.

`config.toml` описывает локальное окружение, а не настройки уже существующего
облачного проекта. Удалённый проект пока не создан и не связан с репозиторием.

## Локальная разработка

Supabase CLI зафиксирован в devDependencies. Для локального стека потребуется
поддерживаемый Supabase runtime, например Docker Desktop; его установка не
входит в npm-зависимости. Команды выполняются из корня репозитория:

```sh
npm run supabase:start
npm run supabase:status
npm run supabase:stop
```

`npm run supabase:reset` удаляет данные локального стека и применяет миграции
заново. Не использовать его для сохранения важных локальных данных.
Supabase CLI 3 по умолчанию направляет DB-команды в локальный стек; облачные
операции не добавлены в scripts и требуют отдельного явного выбора проекта.

Для локальной работы будущих Edge Functions:

```sh
npm run supabase:functions
```

Секреты читаются из игнорируемого корневого `.env`. В облаке их нужно отдельно
настроить в Supabase Secrets. Платформенные служебные ключи Supabase выдаёт
сам; не переносить их во frontend и `.env.example`.

## Миграции и правила доступа

Изменения схемы хранить в `migrations/`. Миграции содержат только схему:
таблицы, типы, PK/FK с правилами `ON DELETE`, `UNIQUE`, простые `CHECK` и
индексы. Функций, процедур и триггеров с бизнес-логикой нет.

Прикладные таблицы не открываются через Data API: браузерные роли `anon` и
`authenticated` не получают GRANT, RLS включён без политик (запрет по
умолчанию). Локальная конфигурация отключает автоматическое открытие новых
таблиц. Edge Functions работают с БД прямым подключением, которое обходит RLS,
поэтому права проверяет каждый метод сервиса.

Код функций:

- `functions/_shared/` — подключение к БД и транзакции, проверка сессии и
  роли, HTTP-ошибки, доменные модули `<модуль>/service.ts` (правила, права,
  аудит) и `<модуль>/repository.ts` (единственное место с SQL);
- `functions/<имя>/index.ts` — тонкий HTTP-обработчик, вызывающий сервисы.

Сейчас одна функция `api` (`verify_jwt = false`, JWT проверяет обработчик):
маршруты `POST /functions/v1/api/<модуль>/<операция>` — `catalog/classes`,
`account/check-nickname` (гостю), `account/me`, `account/avatar-upload`,
`account/complete-registration`, `account/update-profile`; этап 4 —
`applications/list`, `applications/get`, `applications/decide`,
`applications/resubmit`, `roster/count` (гостю), `roster/list`,
`roster/readers`, `accounts/list`, `accounts/set-role`,
`accounts/restore-reader`. Кто вызывает каждую операцию и что пишется в
аудит — таблица в [плане этапа 4](../docs/superpowers/plans/2026-11-11-stage-4-applications-roster.md#операции-функции-api). Импорты Deno —
`functions/api/deno.json` с теми же точными версиями, что в `package.json`.
Auth и Storage вызываются через `fetch`, без `@supabase/supabase-js`, ради
быстрого холодного старта.

Тесты: `npm run supabase:test` (pgTAP в `tests/database/`) и
`npm run test:server` (Vitest по локальному стеку, `tests/server/`).

Типы БД генерируются `npm run supabase:types` в
`functions/_shared/db/database.types.ts` и хранятся в Git; типы Kysely
выводятся из них в `functions/_shared/db/schema.ts`.

Вход — email и пароль; адрес и сброс пароля подтверждаются кодом из письма
(шаблоны в `templates/`, локально — Mailpit), поэтому автоматическая обработка
Auth redirect в браузере выключена. Сессия бессрочная до выхода (Q-35).

Использовать только возможности и объёмы Supabase Free. Не включать платные
опции или долгоживущие фоновые процессы. Учитывать повторы webhook,
идемпотентность, лимиты времени функций и возможную приостановку Free-проекта.
