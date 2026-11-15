# Счётчик новых событий — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Красный счётчик вкладки «Актуальные» показывает новые события и снимается после открытия раздела, а общее число активных событий остаётся обычным текстом.

**Architecture:** Использовать текущую отметку `section_views` и ответ `notifications/summary` для персональной новизны. Вкладка расписания показывает этот счётчик отдельно от общего количества из `events/list`; новые таблицы не нужны.

**Tech Stack:** TypeScript strict, React 19, TanStack Query/Router, Tailwind CSS 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-new-events-counter-design.md`

## Global Constraints

- Разработка только в `main`, Node.js 24, React 19, TypeScript strict и существующие зависимости.
- Данные читаются и меняются только через одну Supabase Edge Function `api`; клиентские запросы — через `callApi`.
- Новизна остаётся персональной по аккаунту; личные уведомления и аудит не затрагиваются.
- Локально e2e не запускаются; новый сценарий будет запущен полным CI при выкладке.

## Review Focus

- Число активных событий не должно попасть в красный счётчик новых — проверка `tests/events.test.tsx`.
- Открытие страницы сбрасывает только новизну раздела текущего пользователя — проверка `tests/notifications.test.tsx` и `e2e/events.spec.ts`.
- При пустом списке активных событий обычное число остаётся нулём, красного индикатора нет — проверка `tests/events.test.tsx`.
- Вкладка «Прошедшие» продолжает показывать общее число прошедших объектов — проверка `tests/events.test.tsx`.
- Счётчик виден и снимается при навигации с другой страницы — проверка `e2e/events.spec.ts`.

---

### Task 1: Отдельно показать новизну и общее число событий

**Files:**
- Modify: `src/features/events/events-page.tsx`
- Modify: `tests/events.test.tsx`

**Interfaces:**
- Consumes: `useNotificationSummary(enabled)` из `src/features/notifications/api.ts`; ответ содержит `sections.events`.
- Consumes: существующие `activeCount` и `pastCount` из `events/list`.
- Produces: красный `NavBadge` только для `sections.events`; обычная подпись количества активных событий; отметка просмотра остаётся в `useHeaderNotifications`.

- [ ] **Step 1: Write failing tests**

В `tests/events.test.tsx` добавьте проверку «показывает красным новые события отдельно от обычного числа активных и снимает красный счётчик после отметки просмотра». Существующая проверка в `tests/notifications.test.tsx` уже подтверждает вызов `notifications/section-seen` при открытии событий.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npx vitest run tests/events.test.tsx tests/notifications.test.tsx`
Expected: FAIL because the events tab currently passes `activeCount` to the red badge.

- [ ] **Step 3: Implement the display change**

Read the existing shared summary query in the events page, render `sections.events` in `NavBadge`, and render `activeCount` as muted tab text. Preserve the existing «Прошедшие» count and route behavior.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run tests/events.test.tsx tests/notifications.test.tsx`
Expected: PASS; the new count clears on section visit and the active total remains.

- [ ] **Step 5: Commit**

```bash
git add src/features/events/events-page.tsx tests/events.test.tsx
git commit -m "fix(events): show unseen events on active tab"
```

### Task 2: Verify the complete navigation behavior

**Files:**
- Modify: `e2e/events.spec.ts`
- Modify: `docs/requirements/README.md` (E2E-12 is already recorded; keep its scenario aligned if selectors require wording changes)

**Interfaces:**
- Consumes: existing test helpers `createMember`, `signInUi`, `callApi`, and `sql` from `e2e/supabase.ts`.
- Produces: E2E-12 coverage for a member who has not opened events, then opens the event schedule.

- [ ] **Step 1: Write the failing browser scenario**

Add `E2E-12: новизна событий снимается при открытии расписания`: create an event as another account, verify the member sees a new-event badge before navigation, open `/events`, verify the red new count is gone and the active total is shown as ordinary text.

- [ ] **Step 2: Keep e2e for CI**

Do not run the browser scenario locally. CI runs it during Step 6.

- [ ] **Step 3: Check the changed-file suite**

Run: `npm run check:quick`
Expected: PASS, including lint, types, styles, architecture and the changed Vitest tests.

- [ ] **Step 4: Commit**

```bash
git add src/features/events/events-page.tsx tests/events.test.tsx tests/notifications.test.tsx e2e/events.spec.ts
git commit -m "fix(events): show unseen events on active tab"
```
