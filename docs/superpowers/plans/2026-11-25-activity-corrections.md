# Корректировка показателей активности — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить ручную корректировку чисел рейтинга и сводки активности с двумя независимыми правами офицеров и общей статистикой посещений.

**Architecture:** Сохранять поправки к агрегатам в отдельной таблице `app.activity_stat_adjustments`, оставляя `event_activity_records` неизменной. Сервер применяет поправки только к общему рейтингу и сводке без фильтра дат; вводимое значение — итоговое число, процент всегда пересчитывается автоматически. Сохранение каждого вида корректировки проходит отдельную серверную проверку права.

**Tech Stack:** TypeScript strict, React 19, TanStack Query/Form, zod, Supabase Edge Function `api`, Kysely, Vitest, pgTAP и Playwright.

**Spec:** [docs/superpowers/specs/2026-11-25-activity-corrections-design.md](../specs/2026-11-25-activity-corrections-design.md)

## Global Constraints

- Все изменения выполняются в `main`; зависимости точные, устанавливаются через `npm clean-install`.
- Новые API-операции проходят через `callApi`; единственный сервер — Edge Function `api` на Supabase Free.
- Доступ к корректировкам проверяется сервером; администратор и мастер обходят индивидуальные права, права офицера по умолчанию выключены.
- Формы используют TanStack Form, zod, `focusFirstInvalid`, `FormField`/`fieldError` и `useUnsavedChangesGuard`.
- История закрытых событий, топ-5 главной, аудит и уведомления корректировками не меняются.
- На телефоне строки таблиц остаются карточками без горизонтальной прокрутки.

## Review Focus

- Период дат в сводке: корректировку отключить, иначе общий итог будет выглядеть как итог выбранного периода; покрыть тестом интерфейса и API.
- Корректировка счётчика посещений одновременно отображается в другой таблице; покрыть серверным и компонентным тестами.
- Новое закрытое событие после поправки увеличивает скорректированный счётчик; закрепить серверным тестом.
- Нулевые значения допустимы, отрицательные и дробные — отклоняются; покрыть контрактными и серверными тестами.
- Удаление пользователя удаляет и его поправки; подтвердить FK и серверным сценарием удаления.

---

### Task 1: Хранение поправок, контракт и серверная защита

**Files:**
- Create: `supabase/migrations/20261125130000_activity_stat_adjustments.sql`
- Modify: `supabase/functions/_shared/contracts/officer-permissions.ts`
- Modify: `supabase/migrations/20261119160000_officer_permissions.sql` is historical and must not be edited; extend its check constraint only in the new migration.
- Modify: `supabase/functions/_shared/contracts/activity.ts`
- Modify: `supabase/functions/_shared/activity/repository.ts`
- Modify: `supabase/functions/_shared/activity/service.ts`
- Modify: `supabase/functions/_shared/app.ts`
- Modify: `supabase/functions/_shared/db/database.types.ts`
- Modify: `supabase/functions/_shared/db/schema.ts`
- Test: `tests/server/activity.test.ts`
- Test: `tests/server/officer-permissions.test.ts`
- Test: `tests/activity-formulas.test.ts`
- Test: `supabase/tests/database/stage23_activity_corrections.test.sql`

**Interfaces:**
- `activity/correct-rating` accepts `{ userId, visited, missed, unmarked, leaderCount, daysInGuild }`; each value is a nonnegative integer.
- `activity/correct-summary` accepts `{ userId, visited, missed, unmarked }`; each value is a nonnegative integer.
- Both operations return the corrected `RatingRow` and summary counts/percentage for the target so clients can update caches.
- `activity/rating` and all-time `activity/summary` responses include whether the actor may correct that view; actor permission is not inferred by the client.

- [ ] **Step 1: Add failing server tests** for master/admin success, separately enabled officer rights, forbidden officer without each right, exact target values, summary/rating sync, immutable event history, and validation rejection for negative/fractional values.
- [ ] **Step 2: Run the activity server tests** with `npm run test:server -- tests/server/activity.test.ts tests/server/officer-permissions.test.ts`; confirm they fail for missing operations/permissions.
- [ ] **Step 3: Add pgTAP tests** for one adjustment row per user, zero defaults, FK cascade on profile deletion, and access denial through browser roles.
- [ ] **Step 4: Run `npm run supabase:test`**; confirm the new schema assertions fail before migration.
- [ ] **Step 5: Create the forward migration** with integer deltas for the five editable aggregates, an effective-value nonnegative check in the service contract, FK cascade, RLS enabled, a service-only grant, and an extended officer permission check constraint containing `activity.correct_rating` and `activity.correct_summary`.
- [ ] **Step 6: Generate database types** with `npm run supabase:types`, register `app.activity_stat_adjustments` in `db/schema.ts`, and update zod contracts for permissions and mutation requests; reject decimals and negative values.
- [ ] **Step 7: Implement transactional exact-value corrections** in `activity/service.ts`: require the relevant permission, lock the profile, compute raw aggregate values, and upsert the difference between requested total and raw total. Keep event rows untouched. For `daysInGuild`, calculate the difference from today’s Moscow baseline so days continue to advance.
- [ ] **Step 8: Apply adjustments to `activity/rating` and all-time `activity/summary` only**; derive percentages from corrected counters. Period-filtered summary remains sourced from the selected closed events and sets summary correction unavailable.
- [ ] **Step 9: Run targeted server and pgTAP tests**; verify the new event after correction increments counts and deletion cascades corrections.

### Task 2: Права в «Мастерке» и кнопки корректировки

**Files:**
- Modify: `src/features/officer-permissions/permissions-page.tsx`
- Modify: `src/features/activity/api.ts`
- Modify: `src/features/activity/query-keys.ts`
- Modify: `src/features/activity/rating-page.tsx`
- Modify: `src/features/activity/activity-page.tsx`
- Modify: `src/features/activity/data-table.tsx`
- Create: `src/features/activity/correction-form.tsx`
- Test: `tests/officer-permissions.test.tsx`
- Test: `tests/activity.test.tsx`

**Interfaces:**
- `useCorrectRating()` and `useCorrectSummary()` call the matching `api` operation with `useMutation` and update rating and summary caches in `onSuccess`.
- `CorrectionForm` receives `kind`, target ID, exact current values and `onSaved`; it submits only nonnegative integers, recalculates no percentage, and uses the common form guard.
- The shared `DataTable` may append a non-sortable action column when the caller supplies row actions; callers without actions keep existing output.

- [ ] **Step 1: Add failing component tests** for two separate permission switches, per-row correction buttons only for authorized actors, disabled summary correction when either date is set, exact-value fields, calculated read-only percent, and mobile card action visibility.
- [ ] **Step 2: Run `npm test -- tests/officer-permissions.test.tsx tests/activity.test.tsx`** and confirm the new assertions fail.
- [ ] **Step 3: Add the two switches** to the existing «Состав и активность» group in `permissions-page.tsx`; both are unchecked unless present in the server response.
- [ ] **Step 4: Add mutation hooks** for `activity/correct-rating` and `activity/correct-summary`; on success update rating and all-time summary caches and invalidate selected-period summary caches as needed.
- [ ] **Step 5: Add the form** using the approved labels, exact-value integer inputs, zero lower bounds, errors through `fieldError`, submit through `useMutation`, and `useUnsavedChangesGuard`.
- [ ] **Step 6: Add row action rendering** to `DataTable`, preserving keyboard access, desktop layout, and mobile card width.
- [ ] **Step 7: Add correction actions** to the rating rows for `canCorrectRating` and summary rows for `canCorrectSummary && !filters.from && !filters.to`; display the percentage as read-only.
- [ ] **Step 8: Run the targeted component tests** and confirm all previous and new assertions pass.

### Task 3: Сквозной сценарий, архитектурная документация и итоговые проверки

**Files:**
- Create: `e2e/activity-corrections.spec.ts`
- Modify: `scripts/seed-dev.ts` if fixture data is needed for officer rights and corrected counters.
- Modify: `docs/architecture/module-decisions.md`
- Modify: `docs/requirements/11-activity.md`
- Modify: `docs/requirements/22-officer-permissions.md`

- [ ] **Step 1: Add Playwright coverage** for master granting each permission, officer editing one table at a time, synchronized counters and computed percentage, no access without the relevant permission, disabled summary action with a date filter, correct data after reload, and history unchanged.
- [ ] **Step 2: Run the new E2E spec locally only if project process permits.** Project release process runs E2E in CI after step 6; local E2E should not run before manual review unless this task’s approved process is changed.
- [ ] **Step 3: Update architecture decisions** with the new adjustment table, write access, server permissions, synchronization and filtered-summary behavior.
- [ ] **Step 4: Run `npm run check:quick`, `npm run test:server`, and `npm run supabase:test`**; fix every failure before showing the manual review environment.
- [ ] **Step 5: Update implementation statuses** for ACT-21–23 and OFP-12–13 after checks; do not claim owner acceptance.
- [ ] **Step 6: Run `npm run security:check`, review staged changes, and commit implementation** with a Conventional Commit message.

## Coverage Review

- ACT-21–23: Tasks 1–3 cover editable fields, automatic percentage, adjustment persistence, synchronized views, period filter, no audit/notifications, future events and responsive row actions.
- OFP-12–13: Tasks 1–3 cover separate default-off permissions, master/admin access, UI visibility and per-operation server denial.
- Existing event history is verified unchanged by server and E2E tests.
