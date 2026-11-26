# Очереди наград КХ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить очереди КХ картинками наград, общим лимитом, автоповтором, заменённым списком участников и закрытой историей выдач.

**Architecture:** Сохранить единую серверную очередь в модуле `kh` и расширить его таблицы, контракты, серверные операции и экран. Все права и лимиты проверяются внутри транзакций одной Edge Function; история выдач хранит снимки ника и награды, а картинки остаются статическими файлами сайта.

**Tech Stack:** TypeScript strict, React, TanStack Query, zod, Kysely, Supabase Postgres, Vitest, pgTAP и Playwright; существующие UI компоненты и иконки из `public`.

**Spec:** `docs/requirements/25-kh-queue.md` (KHQ-01–14), решение Q-127 в `docs/requirements/17-open-questions.md`.

## Global Constraints

- Одна функция Supabase `api`; клиент вызывает её через `callApi`.
- Правила платформы, секретов, ролей, стилей и стека из `AGENTS.md` обязательны.
- Новые поля ответа необязательны либо добавляются совместимыми операциями.
- Миграции только вперёд; секреты не попадают в файлы сайта.
- Все новые списки свыше 50 строк используют курсорную загрузку и виртуализацию.

## Review Focus

- Одновременная запись не может превысить лимит — серверная проверка блокирует настройки/счётчики участника в общей транзакции.
- Пониженный лимит не удаляет уже активные записи и не запускает автоповтор до освобождения места.
- Выдача, история и повтор не расходятся при сбое — одна транзакция сохраняет все части.
- Снимок ника остаётся видимым в истории после удаления аккаунта; записи без аккаунта нельзя снять от чужого имени.
- История недоступна ролям member/officer, даже при прямом вызове `api`.

---

### Task 1: Модель данных и начальный список

**Files:**

- Create: `supabase/migrations/<timestamp>_kh_reward_history_and_limits.sql`
- Modify: `supabase/functions/_shared/db/database.types.ts`, `supabase/functions/_shared/db/schema.ts`
- Modify: `scripts/seed-dev.ts`
- Create: `public/kh-rewards/1.png` … `public/kh-rewards/14.png`
- Test: `supabase/tests/database/kh_queues.test.sql`

**Interfaces:**

- Add nullable `user_id` and required nickname snapshot to `kh_queue_entries`; keep queue order by identity ID.
- Add one-row global setting (default 14), durable pending rejoin rows, and immutable `kh_reward_history` with queue, nickname snapshot, nullable actor/recipient references and timestamp.
- Migration replaces current active rows with the approved 14-column list, matching only exact or explicitly reviewed obvious account nicknames; unmatched rows remain nickname-only.

- [x] **Step 1: Add pgTAP assertions** for nullable nickname-only entries, settings default/range, unique active memberships, persisted issue history, and history surviving profile deletion.
- [x] **Step 2: Run `npm run supabase:test`**; initial missing-schema failures were followed by passing checks after the migration.
- [x] **Step 3: Add forward-only schema and replacement-data migration**, using alias values checked against production account nicknames before release; copy 14 square source images into `public/kh-rewards/`.
- [x] **Step 4: Extend database types and deterministic local seed fixtures**, including linked and nickname-only rows plus varied auto-repeat state.
- [x] **Step 5: Re-run `npm run supabase:test`** and confirm all 239 checks pass.

### Task 2: Server rules for limits, entries and repeat

**Files:**

- Modify: `supabase/functions/_shared/contracts/kh.ts`
- Modify: `supabase/functions/_shared/kh/service.ts`, `supabase/functions/_shared/kh/repository.ts`
- Modify: `supabase/functions/_shared/app.ts`
- Modify: `tests/server/kh.test.ts`

**Interfaces:**

- Add operations `kh/settings`, `kh/set-limit`, `kh/set-repeat`, and master-only `kh/remove`.
- Queue pages return nullable `userId`, nickname snapshot, and repeat flag; settings response returns the shared cap.
- The repository checks current occupancy and the configured cap inside a per-user transaction lock. Pending repeats are ordered by request time and appended only after a spot becomes available.

- [x] **Step 1: Add server tests** for cap 1/14, role permissions, concurrent joins, lowering cap, self/master removal, nickname-only entries, repeats, pending repeats, and role cleanup.
- [x] **Step 2: Run the focused server tests**; initial missing-operation failures were followed by passing tests.
- [x] **Step 3: Implement zod contracts, repository operations and service checks** with writes in `useMutation` callers and SQL transactions.
- [x] **Step 4: Re-run focused server tests** and confirm pass, including concurrent requests and retry after leaving another queue.

### Task 3: Private paged reward history

**Files:**

- Modify: `supabase/functions/_shared/contracts/kh.ts`
- Modify: `supabase/functions/_shared/kh/service.ts`, `supabase/functions/_shared/kh/repository.ts`
- Modify: `supabase/functions/_shared/app.ts`
- Modify: `tests/server/kh.test.ts`, `supabase/tests/database/kh_queues.test.sql`

**Interfaces:**

- Add `kh/history` with `dateFrom`, `dateTo`, cursor `(issued_at, id)`, and page limit 20.
- Return issue time in Moscow date/time, nickname and reward label snapshots.
- Only `admin` and `master` can read history; only `master` can issue. Issue writes the history record and removes/requeues the entry atomically.

- [x] **Step 1: Add server tests** for admin/master access, member/officer denial, date bounds, stable cursor order, history after profile deletion, and atomic issue plus repeat.
- [x] **Step 2: Run focused server and pgTAP tests**; the initial tests failed for the missing operation, then passed after implementation.
- [x] **Step 3: Implement paged repository query and `kh/history` service**, inclusive Moscow calendar dates, with newest-first ordering for the UI.
- [x] **Step 4: Re-run focused server tests and pgTAP**, confirming authorization and boundaries.

### Task 4: KХ screen and management controls

**Files:**

- Modify: `src/features/kh-queues/api.ts`, `src/features/kh-queues/kh-queues-page.tsx`, `src/features/kh-queues/kh-queue-board.tsx`
- Create: `src/features/kh-queues/kh-history-panel.tsx`, `src/features/kh-queues/kh-management-panel.tsx`
- Modify: `tests/kh-queues.test.tsx`

**Interfaces:**

- Read settings and queue data with `useQuery`/`useInfiniteQuery`; all writes use `useMutation` and invalidate `['kh', …]` caches in `onSuccess`.
- The queue board receives cap, occupancy, role, `userId`, and handlers for all controls.
- History panel receives period dates and paginated results; only admin/master render management tabs and history.

- [x] **Step 1: Add component tests** for 14 numbered images, cap feedback, repeat toggle, master removal, 30-day default, date fields, and a fixed-height list viewport of 20 rows.
- [x] **Step 2: Run the focused component tests**; all 11 queue and history panel tests pass.
- [x] **Step 3: Implement responsive controls and history panel** using theme tokens, TanStack Form/VirtualList patterns, and static images.
- [x] **Step 4: Re-run focused component tests**, including phone-width board behavior.

### Task 5: End-to-end acceptance and checks

**Files:**

- Modify: `e2e/kh-queues.spec.ts`
- Modify as required by results: files listed above.

**Interfaces:**

- E2E uses real local Auth/database through the existing helpers; no live Telegram bot or production service.

- [x] **Step 1: Add Playwright scenarios** for cap enforcement, repeat after issue, date-filtered history, role visibility, master removal, and phone/desktop layouts.
- [x] **Step 2: Run `npm run check:quick`, `npm run test:server`, `npm run supabase:test`** and fix all failures.
- [x] **Step 3: Commit implementation with a Conventional Commit message** before manual review, as required by the project workflow.
- [x] **Step 4: Run `npm run review:prepare`** after server checks to restore review data.
- [x] **Step 5: Do not run local e2e**; CI runs all e2e after the release step 6 push.

### Task 6: Исправления по ручному просмотру

**Files:**

- Modify: `src/components/virtual-list.tsx`, `src/features/kh-queues/api.ts`, `src/features/kh-queues/kh-queue-board.tsx`, `src/features/kh-queues/kh-queues-page.tsx`, `src/features/kh-queues/kh-management-panel.tsx`
- Modify: `tests/kh-queues-api.test.tsx`, `tests/kh-queues.test.tsx`, `tests/kh-management-panel.test.tsx`
- Update: `docs/requirements/25-kh-queue.md`, `docs/architecture/module-decisions.md`

**Confirmed feedback:**

- Queue actions must keep the page scroll position. Queue counts and free cells update immediately after joining or leaving.
- Long nicknames and their repeat/action controls must occupy separate rows.
- The compact limit control belongs beside the tabs, directly after the page description.

- [x] Add focused tests for immediate occupancy updates, scroll preservation, non-overlapping queue controls, and compact limit placement.
- [x] Fix scroll correction in the queue virtualizers, mutation cache updates, control layout, and tab-row placement.
- [x] Run focused Vitest checks, type/style checks, lint and secret checks; do not run local e2e.

### Task 7: Расположение отметки повтора и движение колонок

**Files:**

- Modify: `src/features/kh-queues/kh-queue-board.tsx`, `tests/kh-queues.test.tsx`
- Update: `docs/requirements/25-kh-queue.md`, `docs/architecture/module-decisions.md`

- [x] Move the repeat checkbox to the left edge of its control row and keep action buttons on the right.
- [x] Remove the hover bounce from queue columns.
- [x] Run focused queue component tests, type/style/format checks; do not run local e2e.

### Task 8: Ник и действия в одной строке

**Files:**

- Modify: `src/features/kh-queues/kh-queue-board.tsx`, `tests/kh-queues.test.tsx`
- Update: `docs/requirements/25-kh-queue.md`, `docs/architecture/module-decisions.md`

- [x] Keep the repeat checkbox at the left, nickname in the middle, and issue/remove buttons at the right on one row.
- [x] Allow long nicknames to wrap within their grid area without covering controls.
- [x] Run focused queue component tests, type/style/format checks; do not run local e2e.

### Task 9: Прокрутка и центрирование строки очереди

**Files:**

- Modify: `src/features/kh-queues/kh-queue-board.tsx`, `tests/kh-queues.test.tsx`
- Update: `docs/requirements/25-kh-queue.md`, `docs/architecture/module-decisions.md`

- [x] Prevent browser scroll anchoring from shifting the page when a queue entry changes.
- [x] Center the member/officer nickname and repeat checkbox in the cell.
- [x] Run focused queue checks; do not run local e2e.

### Task 10: Устойчивость прокрутки и выравнивание действий

**Files:**

- Modify: `src/features/kh-queues/kh-queue-board.tsx`, `src/features/kh-queues/kh-queues-page.tsx`, `tests/kh-queues.test.tsx`
- Update: `docs/requirements/25-kh-queue.md`, `docs/architecture/module-decisions.md`

- [x] Keep list height stable while free buttons are hidden at the participant limit.
- [x] Align administrator/master nicknames left and controls right.
- [x] Run focused queue checks; do not run local e2e.

### Task 11: Не менять прокрутку при любом нажатии

**Files:**

- Modify: `src/features/kh-queues/kh-queues-page.tsx`
- Verify: queue component and queue mutation tests.

- [x] Remove the page-wide click handler that schedules scroll restoration for every button.
- [x] Keep scroll preservation scoped to queue mutations and verify focused checks.

### Task 12: Сохранять раскрытую очередь на телефоне

**Files:**

- Modify: `src/features/kh-queues/kh-queues-page.tsx`
- Update: `docs/requirements/25-kh-queue.md`, `docs/architecture/module-decisions.md`

- [x] Keep the expanded mobile queue mounted when queue data or counts update.
- [x] Run focused component, type, style, and format checks; do not run local e2e.
