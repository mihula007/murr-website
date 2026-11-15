# Подсветка себя в списках — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выделить фон карточки/строки текущего пользователя в составе, списках участников и групп событий и рейтинге посещения.

**Architecture:** Сравнивать ID строки с ID текущей сессии. Использовать существующий цвет темы `item-highlight`; списки, данные и порядок остаются прежними. Покрыть настольный вид и телефонные карточки строк.

**Tech Stack:** TypeScript strict, React 19, Tailwind CSS 4, TanStack Table, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-self-row-highlight-design.md`

## Global Constraints

- Разработка только в `main`, Node.js 24, React 19, TypeScript strict и существующие зависимости.
- Для фона использовать только существующие токены темы; не добавлять CSS-цвета или зависимости.
- Списки остаются по решению Q-48: весь текущий состав до 200 участников, с защитным ограничением и сообщением при обрезке.
- Подсветка не меняет роли, данные, сортировку, фильтры или порядок; область — только состав, участники/группы события и рейтинг посещения.

## Review Focus

- Подсвечен только аккаунт текущей сессии, не первый элемент и не автор события — проверка `tests/roster-admin.test.tsx`.
- В событии подсвечивается текущий участник и в свободном списке, и в группе — проверка `tests/events.test.tsx`.
- Поиск и сортировка не теряют подсветку ID текущего пользователя — проверка `tests/activity.test.tsx`.
- Администратор видит подсветку своей строки без потери меню действий — проверка `tests/roster-admin.test.tsx`.
- На узком экране фон и текст карточек остаются читаемыми без горизонтальной прокрутки — проверка `e2e/self-highlight.spec.ts`.

---

### Task 1: Подсветить свою карточку в составе

**Files:**

- Modify: `src/features/roster/roster-page.tsx`
- Modify: `tests/roster-admin.test.tsx`

**Interfaces:**

- Consumes: `userId` из текущей сессии, уже передаваемый в `MembersList`.
- Produces: `MemberCard` принимает признак `isCurrentUser` и добавляет `bg-item-highlight` только своей карточке.

- [ ] **Step 1: Write the failing test**

Добавьте `highlights only the current member card`: отрисуйте состав с несколькими участниками, включая текущий ID, проверьте токен фона у своей карточки и отсутствие у остальных.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/roster-admin.test.tsx`
Expected: FAIL because member cards currently have no current-user styling.

- [ ] **Step 3: Add the current-user background**

Pass `isCurrentUser={member.id === userId}` to `MemberCard`; merge `bg-item-highlight` with `tileClass` through `cn`.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/roster-admin.test.tsx`
Expected: PASS; role actions and other cards remain unchanged.

### Task 2: Подсветить себя среди участников и групп события

**Files:**

- Modify: `src/features/events/groups/event-groups.tsx`
- Modify: `tests/events.test.tsx`

**Interfaces:**

- Consumes: participant IDs from `EventDetails` and current session user ID.
- Produces: `PersonRow` marks the matching user with `bg-item-highlight` in the free pool and assigned groups.

- [ ] **Step 1: Write the failing test**

Добавьте `highlights the current participant in the free pool and group`: проверьте свою строку в обоих списках и отсутствие подсветки у другого участника.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/events.test.tsx`
Expected: FAIL because participant rows do not use the current account ID for styling.

- [ ] **Step 3: Add the current account ID to group rows**

Read the ID from the existing session hook, pass it into the group board, and add `bg-item-highlight` to the matching `PersonRow` while preserving drag, leader, and drop states.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/events.test.tsx`
Expected: PASS; group actions and drag behavior remain available.

### Task 3: Подсветить себя в рейтинге посещения

**Files:**

- Modify: `src/features/activity/rating-page.tsx`
- Modify: `src/features/activity/data-table.tsx`
- Modify: `tests/activity.test.tsx`

**Interfaces:**

- Consumes: current session user ID and existing `DataTable` row IDs.
- Produces: optional `highlightRowId?: string` on `DataTable`; rows with the matching ID use `bg-item-highlight` on desktop and mobile.

- [ ] **Step 1: Write the failing test**

Добавьте `highlights the current user in attendance rating`: проверить совпадающую строку, остальные строки и сохранение подсветки после поиска/сортировки.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/activity.test.tsx`
Expected: FAIL because `DataTable` currently renders all rating rows with the same background.

- [ ] **Step 3: Add optional row highlighting**

Read the current session ID in `RatingPage`; pass it as `highlightRowId`. In `DataTable`, apply `bg-item-highlight` when `getRowId(row.original)` matches, without changing other table callers.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/activity.test.tsx`
Expected: PASS; sorting, search, numbering and mobile table layout remain intact.

### Task 4: Verify the visual result on desktop and phone

**Files:**

- Create: `e2e/self-highlight.spec.ts`
- Modify: `docs/requirements/README.md` (E2E-12 is already recorded)

**Interfaces:**

- Consumes: existing Playwright helpers, seeded member account, and the three updated pages.
- Produces: E2E-12 coverage for self-highlighting in roster, event participants/groups, and attendance rating at 375 px and 1240 px.

- [ ] **Step 1: Write the browser scenario**

Add `E2E-12: участник находит себя в основных списках`: create or use a member account, open all three screens, verify only that account has the highlight; repeat at phone width and confirm no horizontal overflow.

- [ ] **Step 2: Keep e2e for CI**

Do not run the browser scenario locally. CI runs it during Step 6.

- [ ] **Step 3: Run the changed-file suite**

Run: `npm run check:quick`
Expected: PASS, including changed Vitest tests, lint, types, styles and architecture checks.

- [ ] **Step 4: Commit**

```bash
git add src/features/roster/roster-page.tsx src/features/events/groups/event-groups.tsx src/features/activity/rating-page.tsx src/features/activity/data-table.tsx tests/roster-admin.test.tsx tests/events.test.tsx tests/activity.test.tsx e2e/self-highlight.spec.ts
git commit -m "feat(ui): highlight current member in lists"
```
