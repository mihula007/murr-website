# Выкладка в облако

Рабочая инструкция этапа 12. Облачный проект Supabase Free `pwmurr`
(ref `fbhndmsmusbqntdymnaz`, регион eu-central-1), сайт — GitHub Pages
на `pwmurr.ru` из ветки `public`. Значения секретов в этом файле не
записываются.

## Где что лежит

| Что                           | Где                                                                     | Секрет |
| ----------------------------- | ----------------------------------------------------------------------- | ------ |
| Схема БД                      | `supabase/migrations/`, применяется `db push`                           | нет    |
| Настройки Auth, API           | `supabase/config.toml`, блок `[remotes.production]`, `config push`      | нет    |
| Buckets Storage               | `[storage.buckets.*]` в `config.toml`, `seed buckets`                   | нет    |
| Функция `api`                 | `supabase/functions/`, `functions deploy`                               | нет    |
| `EVENTS_CRON_SECRET`          | Supabase Secrets функции и Vault `events_cron_secret` (одно значение)   | да     |
| `SITE_URL`                    | Supabase Secrets (`https://pwmurr.ru/`)                                 | нет    |
| `TELEGRAM_*`                  | Supabase Secrets; локальная копия — `.env`                              | да     |
| Адрес функции для расписания  | Vault `events_cron_api_url`                                             | нет    |
| Пароль SMTP (ключ Resend)     | локальный `.env` (`AUTH_SMTP_PASS`), уходит в проект `config push`      | да     |
| Публичная конфигурация сборки | GitHub → Settings → Variables: `VITE_SUPABASE_*`, `PAGES_CUSTOM_DOMAIN` | нет    |
| Пароль БД                     | только менеджер паролей владельца                                       | да     |

`SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_ANON_KEY` и
`SUPABASE_SERVICE_ROLE_KEY` функция получает от платформы; их не задавать.

## Подготовка рабочего места

```sh
npx supabase login
npx supabase link --project-ref fbhndmsmusbqntdymnaz
```

Вход хранит токен локально. Команды ниже идут в облако и спрашивают
подтверждение; агенту оно даётся флагом `--yes` только после согласия
владельца. Docker для выкладки не нужен (`--use-api`).

## Обычный выпуск

Правило совместимости: сначала backend выпускаемого коммита, затем клиент.

1. CI на `main` зелёный (проверки, pgTAP, серверные и браузерные тесты).
2. Миграции, если появились новые:

   ```sh
   npx supabase db push --remote --dry-run
   npx supabase db push --remote
   ```

   Миграции только вперёд: исправление — новая миграция, не правка старой.

3. Настройки, если менялся `supabase/config.toml` (нужны `AUTH_SMTP_*` в
   `.env`, иначе SMTP отправится пустым):

   ```sh
   npx supabase config diff
   npx supabase config push
   ```

   Новые buckets — `npx supabase seed buckets --remote`.

4. Функция, если менялся `supabase/functions/`:

   ```sh
   npx supabase functions deploy api --use-api
   ```

5. Новые секреты функции — `npx supabase secrets set --env-file <файл>`
   из временного файла вне репозитория; затем файл удалить.
6. Клиент:

   ```sh
   git push origin main:public
   ```

   Push запускает **Deploy GitHub Pages**: `npm run check` с облачными
   `VITE_*` и загрузка `dist/`. Только fast-forward; прямые коммиты в
   `public` запрещены.

7. Проверка: в Actions прогон зелёный; на `https://pwmurr.ru` страница
   регистрации загружает классы (запрос `api/catalog/classes` — 200).

## Откат

- **Клиент:** вернуть `public` на прежний коммит —
  `git push --force-with-lease origin <коммит>:public` (только по решению
  владельца). Workflow опубликует его заново.
- **Функция:** выложить `api` из прежнего коммита (`git switch --detach
<коммит>`, затем шаг 4, затем вернуться на `main`).
- **БД:** обратных миграций нет. Ошибку исправляет новая миграция;
  потерянные данные — только из резервной копии ([backup](backup.md)).

## Первичная настройка (выполнено 14.11.2026, кроме отмеченного)

1. Проект Free в eu-central-1; пароль БД — в менеджере паролей.
2. `link`, `db push` (11 миграций: схема `app`, каталог классов, задания
   Cron `events-ensure-weekly` и `cron-history-cleanup`).
3. `seed buckets --remote`: приватные `avatars` и `publication-images`.
4. `functions deploy api --use-api`; `verify_jwt = false` берётся из
   `config.toml`.
5. Secrets: `EVENTS_CRON_SECRET` (случайные 32 байта) и `SITE_URL`.
6. Vault: `events_cron_secret` (то же значение) и `events_cron_api_url`
   (`https://fbhndmsmusbqntdymnaz.supabase.co`).
7. GitHub Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   (publishable key, публичный), `PAGES_CUSTOM_DOMAIN=pwmurr.ru`.
8. Pages: Source — GitHub Actions; environment `github-pages` — только
   ветка `public`; DNS reg.ru — 4 A и 4 AAAA на GitHub, `www` — CNAME на
   `mihula007.github.io`. **Ожидает:** сертификат и Enforce HTTPS.
9. Resend — домен `pwmurr.ru` (DKIM, SPF, DMARC в reg.ru), ключ с правом
   только отправки, `AUTH_SMTP_*` в `.env`, затем `config push`: SMTP,
   6-значные коды, русские письма, `site_url`, 30 писем в час. Без своего
   SMTP Free не даёт менять шаблоны, а встроенная почта пишет только
   участникам организации Supabase.
10. Первый администратор (Q-32): регистрация на сайте до «Завершите
    регистрацию», затем `npm run admin:bootstrap -- …` с `ADMIN_DATABASE_URL`
    в `.env` (строка Session pooler, секрет); после — очистить переменную.
11. **Ожидает:** рабочий бот Telegram — Secrets `TELEGRAM_BOT_TOKEN`,
    `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, затем
    `npm run telegram:webhook -- --functions
https://fbhndmsmusbqntdymnaz.supabase.co/functions/v1`.

## Проверки после настройки

- Таблицы `app`: RLS включён у всех, GRANT для `anon`/`authenticated` нет.
- Маршрут `events/ensure-weekly` с неверным `x-cron-secret` — 403.
- Квоты и пауза Free — [limits](supabase-free-limits.md).
