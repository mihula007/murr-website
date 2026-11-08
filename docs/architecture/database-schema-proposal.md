# Предложение по схеме БД гильдии

Дата: 08.11.2026. Статус: **техническое предложение для согласования**, не утверждённая схема и не разрешение на перенос функций.

Основано на проекте требований в [docs/requirements](../requirements/README.md), включая APP, EVT, GRP, VOT, PUB, MKT, ROS, ACT, DSC, NTF, BRC и ADM. Целевая платформа: Supabase Auth + Postgres Free, статический клиент и Edge Functions без отдельного Node.js-сервера. Данные прототипа не переносятся.

## Цели и границы

- Связать пользователя с `auth.users.id`, не используя email или игровой ник как ключ.
- Отделить роль приложения, блокировку аккаунта и состояние заявки.
- Обеспечить целостность через FK, CHECK и UNIQUE; доступ — через RLS и доверенные серверные операции.
- Сохранить посещения в независимых исторических снимках.
- Описать целевую модель, не создавая миграций, RLS, триггеров, API и прикладной логики. Таблицы добавлять по вертикальным блокам при реализации согласованных требований.

## Рассмотренные подходы

1. **Нормализованные предметные таблицы (предлагается):** ясные связи, ограничения и отдельные политики; соответствует разным переходам и правам.
2. **Универсальные JSONB-документы:** меньше таблиц, но сложнее гарантировать внешние связи, уникальность активной заявки и одного голоса.
3. **Объединение похожих таблиц, например публикаций и рынка:** меньше дублирования, но смешивает различающиеся роли, категории и вложения.

Выбран первый подход; JSONB оставить только для ограниченных метаданных.

## Общие правила модели

- `public` использовать для таблиц, доступных через Data API; внутренние — в закрытой схеме. Для каждой экспонируемой таблицы задать явные GRANT и RLS.
- PK — `uuid`; время — `timestamptz` UTC; даты рождения и вступления — `date`. Изменяемые строки имеют `created_at` и `updated_at`.
- Роль хранить в `profiles.access_role`, не в пользовательских Auth metadata. Email/пароль ведёт Supabase Auth.
- Критические переходы выполнять атомарно через проверенную функцию БД/RPC или Edge Function: например, принять участника, сменить роль, задать дату вступления, создать уведомление и аудит.
- Приложение не удаляет аккаунты (Q-13); не каскадировать удаление профиля. Каскад разрешён только для дочерних данных объектов, удаление которых допускает контракт.
- Сервер повторно проверяет ввод. Ограничения БД дополняют, но не заменяют RLS.

## Предлагаемые таблицы

### Аккаунт и заявки

| Таблица | Поля и ограничения |
| --- | --- |
| `profiles` | `id uuid PK REFERENCES auth.users(id) ON DELETE RESTRICT`; `display_name`, `game_nickname`, `city`, `birth_date date`, `class_id FK character_classes`, `about`; `avatar_path NULL`; `access_role CHECK IN ('applicant','reader','member','officer','admin')`; `is_blocked boolean DEFAULT false`; `joined_on date NULL`; timestamps. Email остаётся в Auth. Внутренний доступ требует принятой роли и `NOT is_blocked`. |
| `character_classes` | `id uuid PK`; `slug UNIQUE`; `name UNIQUE`; `icon_path NULL`; `sort_order`; `is_active`. Справочник из ROS-09; не исправлять спорное написание без согласования. |
| `join_applications` | `id uuid PK`; `applicant_id FK profiles`; `status CHECK IN ('pending_officer_review','pending_vote','vote_completed','officer_approved','officer_rejected','admin_approved','admin_rejected')`; `submitted_at`; `decided_at NULL`; `decided_by FK profiles NULL`; `decision_note NULL`; timestamps. Новая строка на новую заявку после отказа. |
| `application_equipment_links` | `id uuid PK`; `application_id FK join_applications ON DELETE CASCADE`; `url`; `created_at`. Только ссылки, не файлы; допустимое количество уточнить по контракту прототипа. |

Предложение Auth: профиль создаётся доверенным серверным путём при регистрации, заявка — после подтверждения email и идемпотентно. Выбор между trigger и функцией отложить до проектирования Auth. Клиентские metadata не считать доверенными.

### Голосования

| Таблица | Поля и ограничения |
| --- | --- |
| `votes` | `id uuid PK`; `kind CHECK IN ('general','application')`; `title`, `context`; `created_by FK profiles`; `application_id FK join_applications NULL`; timestamps; `closed_at NULL`; CHECK требует `application_id` только для `application`. |
| `vote_options` | `id uuid PK`; `vote_id FK votes ON DELETE CASCADE`; `label`, `normalized_label`, `position`; `UNIQUE(vote_id,position)` и `UNIQUE(vote_id,normalized_label)`. Количество 2–10 и фиксированные варианты заявки проверяет транзакционная функция. |
| `vote_ballots` | `id uuid PK`; `vote_id`; `option_id`; `voter_id FK profiles`; timestamps; `UNIQUE(vote_id,voter_id)`; составной FK `(vote_id,option_id)` к варианту этого же голосования. Смена голоса обновляет строку. |

Связанное голосование удаляется только активным; удаление голосов и возврат заявки в очередь — одна транзакция. Завершённые сохраняются.

### События, группы и шаблоны

| Таблица | Поля и ограничения |
| --- | --- |
| `events` | `id uuid PK`; `title`; `kind CHECK IN ('pvp','pve','clan')`; `starts_at timestamptz`; `timezone_name DEFAULT 'Europe/Moscow'`; `description`; `created_by FK profiles`; timestamps; `closed_at NULL`. Закрытие необратимо. |
| `event_attendance` | `event_id FK events ON DELETE CASCADE`; `user_id FK profiles ON DELETE RESTRICT`; `response CHECK IN ('attending','not_attending','maybe')`; timestamps; `PRIMARY KEY(event_id,user_id)`. Нет строки означает «не отметился». |
| `event_groups` | `id uuid PK`; `event_id FK events ON DELETE CASCADE`; `name`, `position`; `leader_user_id NULL`; timestamps; `UNIQUE(event_id,id)`, `UNIQUE(event_id,position)`. Лидер должен быть в этой группе. |
| `event_group_members` | `event_id`, `group_id`, `user_id FK profiles`, `position`, `created_at`; PK `(group_id,user_id)`; `UNIQUE(event_id,user_id)`; `UNIQUE(group_id,position)`; составной FK `(event_id,group_id)` к `event_groups`. Лидера ограничить составным FK или атомарной серверной проверкой. |
| `event_group_templates` | `id uuid PK`; `name`; `created_by FK profiles`; timestamps. Лимит 20 на автора — атомарная серверная проверка. |
| `event_group_template_groups` | `id uuid PK`; `template_id FK event_group_templates ON DELETE CASCADE`; `name`, `position`; `leader_user_id FK profiles NULL`; `UNIQUE(template_id,position)`. |
| `event_group_template_members` | `template_group_id FK event_group_template_groups ON DELETE CASCADE`; `user_id FK profiles`; `position`; PK `(template_group_id,user_id)`; `UNIQUE(template_group_id,position)`. Лидер должен входить в группу. Шаблон хранит ID, а не актуальные ники/классы. |

Постоянные еженедельные события — генерация конкретного выпуска, не бесконечные строки. Выпуск хранит абсолютное время и `Europe/Moscow`; идемпотентность обеспечивается ключом правила и даты либо транзакционной проверкой.

### Снимки активности

| Таблица | Поля и ограничения |
| --- | --- |
| `event_activity_snapshots` | `event_id PK FK events ON DELETE RESTRICT`; `title`, `kind`, `starts_at`, `closed_at`, `created_at`. Создать ровно одну строку атомарно с закрытием события. |
| `event_activity_snapshot_groups` | `id uuid PK`; `event_id FK event_activity_snapshots ON DELETE RESTRICT`; `name`, `position`; `leader_user_id NULL FK profiles`; `leader_nickname NULL`; `UNIQUE(event_id,id)`, `UNIQUE(event_id,position)`. |
| `event_activity_snapshot_people` | `id uuid PK`; `event_id FK snapshot`; `user_id FK profiles ON DELETE RESTRICT`; `group_id NULL`; `nickname`, `display_name`, `class_name` (снимки); `response NULL`; `attendance_status CHECK IN ('attended','not_attended','no_response')`; `created_at`; `UNIQUE(event_id,user_id)`; составной FK `(event_id,group_id)` к snapshot groups. |

При закрытии копируется актуальный состав, ответы, группы и лидеры. Член сохранённой группы получает `attended`; участник вне группы с ответом — `not_attended`; без ответа — `no_response`. Позднее вступивший не добавляется задним числом. Изменение профиля не меняет историю. Разрешённое исправление снимка — отдельная аудируемая админская операция.

### Публикации и рынок

| Таблица | Поля и ограничения |
| --- | --- |
| `publications` | `id uuid PK`; `category CHECK IN ('article','announcement','news','guide','rules')`; `title`, `summary`, `body_html`; `status CHECK IN ('draft','published','unpublished')`; `author_id FK profiles`; `show_author`, `discussion_enabled`; `published_at NULL`; timestamps. HTML очищается сервером по PUB-12. |
| `publication_attachments` | `id uuid PK`; `publication_id FK publications ON DELETE CASCADE`; `storage_path UNIQUE`; `original_name`; `mime_type CHECK IN ('image/jpeg','image/png','image/webp')`; `size_bytes CHECK (size_bytes BETWEEN 1 AND 1048576)`; `position`; `created_at`; `UNIQUE(publication_id,position)`. Содержимое в приватном Storage bucket, не в `bytea` и не по постоянной публичной ссылке. |
| `market_listings` | `id uuid PK`; `category CHECK IN ('sell','buy','trade','services','free')`; `title`, `summary`, `body_html`; `status CHECK IN ('draft','published','unpublished')`; `author_id FK profiles`; `discussion_enabled`; `published_at NULL`; timestamps. Вложений нет; автор обязателен. |

Раздельные таблицы сохраняют отдельные политики и запрет файлов для рынка. Не добавлять произвольные JSONB-поля редактора без потребности.

### Обсуждения

Общие сообщения с FK на каждый допустимый родитель предпочтительнее `parent_type + parent_id` без FK. CHECK требует ровно одного заданного родителя.

| Таблица | Поля и ограничения |
| --- | --- |
| `discussion_messages` | `id uuid PK`; nullable `event_id`, `vote_id`, `publication_id`, `market_listing_id` с FK; `author_id FK profiles`; `reply_to_id FK discussion_messages ON DELETE SET NULL`; `body CHECK (length(trim(body)) BETWEEN 1 AND 2000)`; timestamps; `CHECK (num_nonnulls(event_id,vote_id,publication_id,market_listing_id)=1)`. Ответ должен быть из той же ветки (серверная проверка). |
| `discussion_reactions` | `message_id FK discussion_messages ON DELETE CASCADE`; `user_id FK profiles`; `emoji CHECK IN ('❤️','👍','👎','😂','🔥','😢','😭','😐','👌','😮')`; `created_at`; PK `(message_id,user_id,emoji)`. |
| `discussion_reads` | `message_id FK discussion_messages ON DELETE CASCADE`; `user_id FK profiles`; `read_at`; PK `(message_id,user_id)`. Видимость читателей определяется DSC/Q-20. |

Срок редактирования 5 минут и запрет записи в архив/снятый материал проверяются сервером.

### Уведомления и посещения

| Таблица | Поля и ограничения |
| --- | --- |
| `user_notifications` | `id uuid PK`; `recipient_id FK profiles`; `actor_id FK profiles NULL`; `kind`, `title`, `body`; `target_kind NULL`, `target_id NULL`; `source_kind`, `source_id`; `created_at`, `read_at NULL`; `UNIQUE(recipient_id,source_kind,source_id,kind)`. Навигационная ссылка не предоставляет доступ к объекту. |
| `user_section_visits` | `user_id FK profiles`; `section_key CHECK IN ('events','votes','publications','market','applications','accounts')`; `last_seen_at`; PK `(user_id,section_key)`. Персональные индикаторы новых объектов отделены от непрочитанных уведомлений; алгоритм первого просмотра по NTF-12. |

Уведомление не создаётся инициатору о собственном действии. Почтовая, push- и бот-доставка вне этой модели.

### Черновики рассылок

| Таблица | Поля и ограничения |
| --- | --- |
| `broadcast_templates` | `id uuid PK`; `name`, `subject`, `body`; `channels text[]` из `telegram`,`vk`,`max`; `created_by FK profiles`; timestamps. Лимит 20 на владельца. |
| `broadcast_drafts` | `id uuid PK`; `subject`, `body`, `channels`; `created_by FK profiles`; nullable `source_event_id`, `source_vote_id`, `source_group_id` с FK; timestamps; не более одного контекста. Пока только метаданные файлов. |
| `broadcast_draft_attachments` | `id uuid PK`; `draft_id FK broadcast_drafts ON DELETE CASCADE`; `original_name`, `mime_type`; `size_bytes CHECK (size_bytes BETWEEN 1 AND 20971520)`; `created_at`. |

Outbox и аккаунты мессенджеров сейчас не нужны (Q-22). При отдельном проектировании добавить записи доставки с idempotency key, статусом, ограниченными повторами и внешним ID, без секретов. Не предполагать постоянно работающий worker на Free.

### Аудит

`audit_log`: `id bigint GENERATED ALWAYS AS IDENTITY PK`; `actor_id FK profiles NULL`; `actor_role` (снимок роли); `action`, `category`, `target_kind`, `target_id NULL`, `summary`; `details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details)='object')`; `created_at`. Только INSERT доверенными функциями; запрет UPDATE/DELETE клиентским ролям. `details` — allowlist бизнес-метаданных, без паролей, токенов, кодов, секретов или полного текста анкеты/чата.

Действия ADM-11/Q-23, включая прямой приём Q-24, и запись аудита выполняются одной транзакцией. UI показывает последние 1000 записей, но это не срок хранения таблицы; retention согласуется отдельно.

## Связи

`auth.users 1—1 profiles`; классы `1—N profiles`; профиль `1—N заявок`; заявка `0—1` голосование; голосование `1—N` вариантов/голосов; событие `1—N` ответов/групп; группа `1—N` участников; событие при закрытии `1—1` снимок с группами и людьми; публикация `1—N` вложений; у события/голосования/публикации/рынка отдельные ветки сообщений; сообщение `1—N` реакций/прочтений; профиль `1—N` уведомлений, шаблонов и аудиторских действий.

Основные уникальности: одна активная заявка на профиль; одно активное связанное голосование на заявку; один текущий голос на пользователя в голосовании; один ответ на событие; одна группа пользователя на событие; одна реакция каждого вида на сообщение; один read receipt на пользователя/сообщение; один snapshot на событие.

## Индексы

PK, UNIQUE и индексы ниже добавлять вместе с таблицей. Индексировать под реальные запросы; проверять `EXPLAIN (ANALYZE, BUFFERS)`. Каждый индекс увеличивает хранение и цену записи.

| Таблица | Индекс | Назначение |
| --- | --- | --- |
| `profiles` | `UNIQUE(lower(game_nickname))`; `(access_role,is_blocked)`; `(class_id,access_role)` | Упоминания, roster и админ-фильтры. Уникальность/смена ника подтвердить. |
| `join_applications` | partial UNIQUE `(applicant_id) WHERE status IN ('pending_officer_review','pending_vote','vote_completed')`; `(status,submitted_at DESC)`; `(applicant_id,created_at DESC)` | Одна активная заявка, очередь, история. |
| `votes` | partial UNIQUE `(application_id) WHERE application_id IS NOT NULL AND closed_at IS NULL`; `(closed_at,created_at DESC)` | Одно активное связанное голосование и списки. |
| vote options/ballots | UNIQUE `(vote_id,position)`, `(vote_id,normalized_label)`; UNIQUE `(vote_id,voter_id)`, индекс `(vote_id,option_id)` | Порядок, уникальность и агрегаты. |
| `events` | partial `(starts_at) WHERE closed_at IS NULL`; `(closed_at,starts_at)` | Ближайшие и архивные события. |
| attendance/groups | attendance PK `(event_id,user_id)` плюс `(user_id,event_id)`; UNIQUE `(event_id,user_id)` для group members; `(group_id,position)` | Ответы, состав, порядок и поиск по пользователю. |
| snapshot people | `(user_id,event_id)`; `(event_id,attendance_status)`; `(event_id,group_id)` | Рейтинг и фильтры аналитики. |
| publications/listings | partial `(published_at DESC) WHERE status='published'`; `(author_id,updated_at DESC)`; `(category,published_at DESC)` | Ленты и собственные черновики. |
| content search | GIN full-text по title/summary и серверно очищенному body | Поиск. На малом объёме начать с обычного поиска. |
| attachments | `(publication_id,position)`, UNIQUE `storage_path` | Вложения материала. |
| `discussion_messages` | partial `(event_id,created_at,id)` и аналоги по `vote_id`, `publication_id`, `market_listing_id`; `(author_id,created_at DESC)` | История ветки. |
| reactions/reads | PK `(message_id,user_id,emoji)`; `(message_id,emoji)`; PK `(message_id,user_id)`; `(user_id,read_at DESC)` | Уникальность и чтения. |
| `user_notifications` | `(recipient_id,created_at DESC)`; partial `(recipient_id,created_at DESC) WHERE read_at IS NULL`; UNIQUE `(recipient_id,source_kind,source_id,kind)` | История, непрочитанное и дедупликация. |
| broadcasts | `(created_by,created_at DESC)` | Свои шаблоны/черновики. |
| `audit_log` | `(created_at DESC,id DESC)`; `(category,created_at DESC,id DESC)`; `(actor_id,created_at DESC)`; `(target_kind,target_id,created_at DESC)` | Последние события и фильтры. |

`pg_trgm` — возможное расширение для неточного поиска после проверки доступности и профилирования. Не индексировать весь JSONB аудита без сценария. Счётчики сначала считать SQL-запросами; материализовать только после измерений.

## RLS и границы доверия

RLS включён для всех таблиц Data API. Политики проверяют `auth.uid()` и актуальный профиль через закрытую функцию наподобие `private.current_access_role()`, не через клиентские параметры или mutable metadata. Для `SECURITY DEFINER` фиксировать `search_path`, минимизировать права, проверять вызывающего. Service Role Key запрещён в клиенте.

- Владелец читает/правит свой профиль; администратор управляет аккаунтами. Общий roster не раскрывает email, день рождения, город, рассказ и ссылки анкеты.
- Кандидат читает статус только своей заявки; офицер рассматривает, окончательное решение после голосования принимает администратор. Переходы только через серверную операцию.
- Участники читают голосования/агрегаты; индивидуальные голоса доступны офицерам/админам. Внутренние функции закрыты для кандидата/reader.
- Внутренние роли читают события; группы управляются officer/admin; officer меняет только свои события. Закрытый snapshot не редактируется обычными ролями.
- Контент: внутреннее чтение опубликованного; владельцу — свои черновики; officer — свои публикации; admin — все. Рынок без файлов.
- Уведомления читает получатель; `target_*` не авторизует доступ. Чат дополнительно проверяет статус родителя.
- Аудит читает только admin, вставка доверенная; для всех таблиц, дочерних строк и Storage объектов нужны явные GRANT/RLS policies.

Скрытая кнопка UI не является защитой. Прикладные роли и RLS должны одинаково запрещать действие на стороне сервера.

## Расширение и эксплуатация Supabase Free

- Медиа хранить в приватном Storage, не в `bytea`; выдавать авторизованный доступ/короткие signed URL. Перед запуском проверить актуальные квоты Supabase.
- Не вводить обязательный платный сервис или постоянно работающий worker. Будущие фоновые действия — короткие Edge Functions, идемпотентность и ограниченные повторы.
- Миграции версионировать; TypeScript-типы генерировать из локальной схемы. Для каждой миграции проверять RLS и отсутствие широких grants.
- Агрегаты добавлять после профилирования; источником посещаемости остаются snapshot-строки.
- Срок хранения персональных данных и очистку Storage согласовать до запуска: требования пока не задают retention.

## Открытые решения

1. Q-10/Q-15: подтверждение Auth, передача регистрационных данных, момент создания профиля/заявки, смена ника.
2. Q-12: нужны ли roster-персонажи без Auth аккаунта.
3. Q-13/Q-21: поведение ссылок уведомлений на удалённый объект и retention уведомлений.
4. Q-17: формат HTML публикаций и серверная очистка.
5. Q-20: приватность прочтений сообщений.
6. Q-22: будущая доставка в мессенджеры, аккаунты, файлы, адресаты и статусы.
7. Q-23: срок хранения аудита отдельно от экранного лимита 1000.
8. Аналитика: точная логика периодов и процедура исправления исторических снимков.

Имена и декомпозиция — предложение автора. После согласования требований миграции выполнять по вертикальным блокам (аккаунт/заявки; события/группы/snapshot; голосования; контент/обсуждения; уведомления/аудит; рассылки). Не создавать таблицы заранее без задачи соответствующего блока.
