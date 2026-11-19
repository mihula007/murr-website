# Индивидуальные права офицеров — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить раздел «Мастерка», где Мастер и Администратор настраивают отдельные права офицеров, а интерфейс и сервер применяют их при каждом действии.

**Architecture:** Хранить только выданные права офицера в отдельной таблице: отсутствующая запись означает выключенное право. Единый серверный помощник проверяет эти записи и пропускает Мастера и Администратора без ограничений; существующий ответ `account/me` передаёт права клиенту для меню и маршрутов. Сохранение настроек выполняется одной операцией, меняет только отличающиеся значения и записывает каждое изменение в аудит.

**Tech Stack:** TypeScript strict, React 19, TanStack Router/Query/Form, zod, Supabase Edge Function `api`, Postgres, Vitest, серверные тесты и pgTAP.

**Spec:** [22-officer-permissions.md](../../requirements/22-officer-permissions.md)

## Global Constraints

- Работа только в `main`; ветки и отдельные рабочие копии не создавать.
- Клиент — React 19 + Vite, опубликованный на GitHub Pages; серверная часть — одна Supabase Edge Function `api`.
- Использовать только существующие зависимости и бесплатные возможности Supabase.
- Защищать каждую операцию на сервере; скрытого пункта меню недостаточно.
- Новые изменения структуры базы вносить только новой миграцией вперёд.
- Не запускать Playwright e2e локально; новый сценарий написать, запуск выполняется CI после принятия ручной проверки.
- Для таблиц и списков свыше 50 записей применять серверный поиск и курсорную загрузку; список офицеров ограничен 50.
- Все права новых и существующих офицеров при выпуске выключены. Базовые возможности члена клана остаются доступны.
- Перед изменением каждого серверного или клиентского модуля соблюдать его раздел `docs/architecture/module-decisions.md`.

## Review Focus

- Прямой вызов запрещённой операции не работает после выключения права — проверить отрицательными серверными тестами для каждого защищённого семейства операций.
- Мастер и Администратор сохраняют доступ, а офицер без дополнительных прав сохраняет членские возможности — проверить серверные и клиентские тесты.
- Очередь, карточки и решение заявки требуют `applications.review`; остальные права заявки без него нельзя сохранить или использовать — проверить сохранение и все пути чтения/действия.
- Без полного просмотра ивента офицер видит тот же ограниченный состав, что член; без просмотра голосов видны только агрегированные итоги — проверить ответы `events/get` и `votes/get`.
- Смена выбранного офицера, ошибка сохранения и уход с грязной формы не теряют несохранённые права — проверить форму и защиту перехода.

---

### Task 1: Добавить хранение прав и управляемую операцию настройки

**Files:**

- Create: `supabase/migrations/20261119160000_officer_permissions.sql`
- Create: `supabase/tests/database/stage19_officer_permissions.test.sql`
- Create: `supabase/functions/_shared/officer-permissions/{contracts,repository,service}.ts` (следовать существующему устройству модулей; если сборка проекта требует плоской папки, держать эти три файла в `officer-permissions/`)
- Modify: `supabase/functions/_shared/app.ts`
- Modify: `supabase/functions/_shared/contracts/account.ts`
- Modify: `supabase/functions/_shared/account/service.ts`
- Modify: `supabase/functions/_shared/contracts/audit.ts`
- Modify: `supabase/functions/_shared/audit/service.ts`
- Modify: `tests/server/support.ts`
- Test: `tests/server/officer-permissions.test.ts`

**Interfaces:**

- `OfficerPermissionCode` — объединение кодов из каталога OFP; список допустимых кодов и русские названия определены в одном общем контракте.
- `getOfficerPermissions(db, officerId)` возвращает только включённые права; у офицера без строк — пустой список.
- `requireOfficerPermission(deps, actor, permission)` разрешает только `officer` с выданным правом и безусловно пропускает `master` и `admin`; другие роли получают `forbidden`.
- `officer-permissions/list` возвращает все аккаунты с ролью `officer` (не более 50), ник и список выданных кодов для каждого; `officer-permissions/save` принимает ID выбранной цели и полный набор включённых кодов и применяет его транзакционно.
- Операции настройки доступны только `master` и `admin`; каждая цель записи должна иметь роль `officer`.
- Для `applications.submit_vote`, `applications.decide_after_vote` и `applications.decide_direct` обязательна также `applications.review`; сервер отвергает недопустимую комбинацию до записи.
- Таблица содержит строки только для включённых прав; уникальность пары офицер/код не допускает дубликатов, код ограничен каталогом, удаление профиля очищает строки каскадно, доступ через публичный Data API закрыт.
- Аудит категории `officer_permissions` добавляет по одной записи на каждое фактически изменённое право, с исполнителем, целью, кодом права и новым значением. Сохранение без различий не пишет аудит.
- `account/me` возвращает `officerPermissions` для офицера; для остальных ролей возвращает пустой список. Учётная запись Мастера и Администратора не зависит от списка.

- [ ] **Step 1: Написать падающие серверные и pgTAP проверки.** Проверить отсутствие грантов по умолчанию, запрет доступа к таблице через роли Data API, отказ ненастоящей роли и офицера без гранта, обход проверки для Мастера/Администратора, запрет не-администратору настраивать права, запрет цели не-офицера, атомарность, аудит только изменений и зависимость прав заявок от `applications.review`.
- [ ] **Step 2: Запустить проверки и подтвердить ожидаемый отказ.** Запустить `npm run test:server -- tests/server/officer-permissions.test.ts` и `npm run supabase:test`; новые проверки должны упасть до реализации.
- [ ] **Step 3: Добавить миграцию и контракт.** Создать таблицу выдаваемых разрешений с ограничением списка кодов; обновить типы БД командой проекта для генерации типов.
- [ ] **Step 4: Реализовать чтение, проверку и атомарное сохранение.** Сравнивать присланный набор с сохранёнными строками, отклонять лишние коды/неверные зависимости и писать аудит в той же транзакции.
- [ ] **Step 5: Подключить `account/me` и операции в `app.ts`.** Возвращать права только текущему офицеру; список и сохранение закрыть ролью `master`/`admin`.
- [ ] **Step 6: Повторить серверные и pgTAP проверки.** Обе команды из шага 2 должны пройти.

### Task 2: Проверить права заявок, рассылок, голосований, активности, состава и публикаций на сервере

**Files:**

- Modify: `supabase/functions/_shared/applications/service.ts`
- Modify: `supabase/functions/_shared/broadcasts/service.ts`
- Modify: `supabase/functions/_shared/votes/service.ts`
- Modify: `supabase/functions/_shared/activity/service.ts`
- Modify: `supabase/functions/_shared/roster/service.ts`
- Modify: `supabase/functions/_shared/publications/service.ts`
- Modify: `tests/server/applications.test.ts`, `tests/server/broadcasts.test.ts`, `tests/server/votes.test.ts`, `tests/server/activity.test.ts`, `tests/server/roster.test.ts`, `tests/server/publications.test.ts`

**Interfaces:**

- Защищать чтение очереди и карточек заявок правом `applications.review`; передача на голосование, решение после голосования и прямое решение дополнительно требуют своё право из каталога.
- Создание/отправка рассылок и работа с черновиками требуют `broadcasts.send`; общие шаблоны — `broadcasts.templates`; подписки — `broadcasts.subscriptions`.
- Создание/изменение голосований требуют `votes.manage`; завершение и удаление — `votes.complete_delete`; обычное участие членов в голосованиях остаётся доступно.
- Для офицера история, сводки и экспорт активности требуют `activity.view_export`; обычные членские сводки, уже доступные всем членам, остаются доступны.
- Изменение ролей чтеца требует `roster.reader_roles`; другие смены ролей не расширяются.
- Управление публикациями офицером ограничено собственными материалами и требует `publications.manage_own`; членский просмотр остаётся доступен. Рынок не получает нового гранта, чужими объявлениями по-прежнему управляет только Администратор.
- Тестовый помощник `createProfiledUser` явно выдаёт полный набор тестовому офицеру, где старые тесты проверяют поведение уполномоченного офицера; отдельные новые тесты оставляют права выключенными.

- [ ] **Step 1: Добавить отрицательные тесты на выключенные права и положительные на выданные.** Для каждой операции из списка подтвердить `forbidden` без нужного права и успех с правом; подтвердить, что базовые права члена и операции Администратора не сломаны.
- [ ] **Step 2: Запустить затронутые серверные тесты и проверить, что новые кейсы падают.** Запустить перечисленные шесть файлов через `npm run test:server -- …`.
- [ ] **Step 3: Подключить `requireOfficerPermission` к чтению и изменению каждого домена.** Сохранить текущие ограничения авторства и транзакции; для права управления публикациями явно сохранить предел «только свои».
- [ ] **Step 4: Обновить серверные фикстуры.** Старые сценарии офицерских полномочий получают требуемые гранты явно; тесты начального состояния используют офицера без грантов.
- [ ] **Step 5: Повторить затронутые серверные тесты.** Все новые отрицательные и положительные проверки должны пройти.

### Task 3: Ограничить полные данные ивента и отдельные голоса

**Files:**

- Modify: `supabase/functions/_shared/events/service.ts`
- Modify: `supabase/functions/_shared/votes/service.ts`
- Modify: `tests/server/events.test.ts`, `tests/server/votes.test.ts`
- Modify as required by typed responses: `supabase/functions/_shared/contracts/events.ts`, `supabase/functions/_shared/contracts/votes.ts`

**Interfaces:**

- `events.view_full_roster` открывает офицеру полные списки участников и групп события, включая архивное представление по действующему правилу GRP-19. Без него сервер применяет проекцию члена клана: только назначенная офицеру группа и её участники; если назначения нет — списки пусты, общий ответ и числа остаются.
- `votes.view_ballots` открывает офицеру имена участников и их индивидуальный выбор. Без него сервер возвращает доступные обычному члену агрегированные итоги, без имён и строк отдельных голосов.
- Мастер и Администратор сохраняют полные данные согласно текущим правилам.

- [ ] **Step 1: Добавить серверные проверки на состав и бюллетени.** Сравнить офицера без права, офицера с правом, члена, Мастера и Администратора; проверить ответы без утечки идентификаторов/выборов.
- [ ] **Step 2: Запустить тесты событий и голосований до изменения кода.** Подтвердить отказ новых ожидаемых сценариев.
- [ ] **Step 3: Применить право к проекции `events/get` и ответу `votes/get`.** Проверять грант до формирования раскрытых данных; обычное голосование и собственный голос пользователя не менять.
- [ ] **Step 4: Повторить серверные тесты.** Убедиться, что состав и индивидуальные голоса раскрываются только с соответствующим правом.

### Task 4: Добавить сброс грантов при смене роли

**Files:**

- Modify: `supabase/functions/_shared/accounts/service.ts`
- Modify: `supabase/functions/_shared/accounts/repository.ts`
- Modify: `tests/server/accounts.test.ts`

**Interfaces:**

- При переходе офицера в любую другую роль все гранты удаляются в той же транзакции, что смена роли.
- Для каждого очищенного права создаётся запись аудита с целевым офицером и выключенным значением; смена роли без грантов не добавляет лишних записей аудита.
- Повторное назначение офицером не создаёт грантов.

- [ ] **Step 1: Добавить тесты смены роли с включёнными и пустыми грантами.** Проверить очистку и аудит, повторное назначение без прав и отсутствие лишнего аудита.
- [ ] **Step 2: Запустить `tests/server/accounts.test.ts` и подтвердить ожидаемое падение новых сценариев.**
- [ ] **Step 3: Включить удаление грантов в существующую транзакцию смены роли.** Сохранить порядок блокировок профиля и текущие проверки целей/ролей.
- [ ] **Step 4: Повторить `tests/server/accounts.test.ts`.** Все сценарии сброса и прежние правила смены роли должны пройти.

### Task 5: Добавить клиентскую страницу «Мастерка» и фильтрацию доступа

**Files:**

- Modify: `src/app/access.tsx`, `src/app/navigation.ts`, `src/app/shell/header.tsx`, `src/components/route-gate.tsx`
- Create: `src/routes/permissions.tsx`
- Create: `src/features/officer-permissions/api.ts`, `src/features/officer-permissions/permissions-page.tsx`, `src/features/officer-permissions/permission-switch.tsx`
- Modify: `src/routes/sections.tsx` if its generated section route needs explicit handling
- Modify: client APIs/pages/components for the above protected domains and their management actions
- Modify: `tests/navigation.test.ts`, `tests/access.test.tsx`, focused route and feature component tests

**Interfaces:**

- `AccessContext` exposes typed `officerPermissions`; `hasOfficerPermission(code)` returns true for a listed officer grant and for `master`/`admin` bypass roles.
- Navigation and `RouteGate` accept a required permission in addition to current role visibility. «Мастерка» itself is visible only to Mастер and Администратор. A management category disappears when all of its specific management actions are unavailable; shared/member destinations stay visible.
- The page loads up to 50 officers and their current enabled-code list. Every catalog row has an accessible switch, grouped and ordered as the requirements table; all unchecked means disabled. `applications.review` controls dependent switches and turning it off also clears them in the form.
- The page uses TanStack Form + zod and `useUnsavedChangesGuard`; one «Сохранить» button submits all selected codes. Changing officer prompts before discarding dirty values. Errors preserve the form and saved state; success refreshes officer list/details and current `account/me` when relevant.
- Switches use the project’s existing accessible controls and styling tokens; no new package.
- At phone widths rows wrap without horizontal scrolling; on desktop label and switch stay on one row.
- `events/get` / `votes/get` response differences render as specified; forbidden mutation controls and restricted management sections are hidden from the officer.

- [ ] **Step 1: Add failing client tests.** Cover role visibility, permission-gated navigation/routes, all-off initial form, dependency toggles, save-all behavior, unsaved officer selection, save error, master/admin bypass, and narrow viewport structure.
- [ ] **Step 2: Run focused Vitest files and verify failure.** Run only newly affected navigation/access/permission component tests.
- [ ] **Step 3: Add permission-aware access state and navigation gates.** Keep member-level pages available to officers; hide only the management action or area controlled by a missing grant.
- [ ] **Step 4: Build the permission editor.** Add complete officer selector, grouped accessible switches, dependency behavior, unsaved guard, one save action and error/success states.
- [ ] **Step 5: Apply permission checks to feature controls.** Align page buttons, tabs and route access with the server catalog; keep normal member functionality visible.
- [ ] **Step 6: Repeat focused client tests.** Confirm all role, persistence and mobile layout cases pass.

### Task 6: Update local sample accounts, e2e coverage, and requirement status

**Files:**

- Modify: `scripts/seed-dev.ts`
- Modify: `e2e/helpers.ts` or `e2e/supabase.ts` for explicit officer grants in existing privileged scenarios
- Create or modify: `e2e/officer-permissions.spec.ts`
- Modify: `docs/requirements/01-roles.md`, `docs/requirements/15-admin.md`, `docs/requirements/README.md`, `docs/architecture/module-decisions.md`

**Interfaces:**

- Local data includes at least one officer with all rights off and one with representative rights enabled; existing e2e tests that exercise privileged officer actions grant those rights explicitly.
- New e2e coverage checks manager-only page access, default-off state, saving and reloading settings, hidden and server-rejected action, full-event and individual-vote visibility toggles, and reset on role change. Do not run e2e locally.
- Requirement status tables and module decisions describe the implemented permission contract and the next E2E identifier accurately.

- [ ] **Step 1: Add e2e scenarios and seed fixtures.** Ensure new behavior is reproducible with only local seeded identities and does not call real Telegram credentials.
- [ ] **Step 2: Run server, database, and quick checks.** Run `npm run test:server`, `npm run supabase:test`, and `npm run check:quick`; fix every failure. Do not launch Playwright e2e.
- [ ] **Step 3: Update requirement/status and module decision references.** Mark only verified work complete and document role checks, projection behavior, transaction and audit invariants.
- [ ] **Step 4: Run `npm run security:check`, `git diff --check`, and inspect the full diff.** Confirm no secrets, no unrelated edits, and requirements/catalog/test labels agree.
- [ ] **Step 5: Save implementation in a Conventional Commit on `main`.** Keep it separate from the already saved requirements and plan commits; do not push.
- [ ] **Step 6: Prepare the local manual review.** Run `npm run review:prepare`; start `npm run e2e:functions` and `npm run dev` in the background if they are not already running. Provide the local address, test accounts/password from `tests/server/support.ts`, and concise desktop/mobile checks. Offer exactly «Принять и выложить на сайт» and «Есть замечания».

## Required separate saves

- Requirements and decisions are saved in `docs(requirements): add officer permissions`, `docs(requirements): clarify application permissions`, and `docs(requirements): add officer visibility permissions`.
- Save this plan in a separate documentation commit before application code.
- Save implementation in its own Conventional Commit after required checks. Push and publish only after the owner accepts the local review.
