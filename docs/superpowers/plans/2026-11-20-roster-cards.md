# Roster Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Refresh roster cards with one fixed class illustration per class and make the member tab load an unbounded roster in virtualized 24-item pages.

**Architecture:** Keep all roster data and access rules in the existing Supabase `api` function. Add a cursor-based `roster/page` operation for the member tab while preserving `roster/list` for existing consumers; render class-specific imported WebP art in the current React roster UI.

**Tech Stack:** TypeScript strict, React 19, TanStack Query, TanStack Virtual, Vite, Tailwind CSS 4, Supabase Edge Function (`api`), Vitest, Playwright.

**Spec:** [2026-11-20-roster-card-refresh-design.md](../specs/2026-11-20-roster-card-refresh-design.md)

## Global Constraints

- Work in `main`; do not create a branch or worktree.
- Use Node.js 24 and exact dependencies from the lockfile; do not add a dependency.
- Use one Supabase Edge Function, `api`; do not add a table, migration, paid service, or VPS.
- Keep private profile fields and service credentials out of roster page responses and client bundles.
- Preserve the existing `roster/list` response and behavior for the home page, rating, events, groups, and activity.
- Use only local archive artwork; use the `v1` WebP for each of the 17 existing classes, fixed for everyone in that class.
- Follow Tailwind theme tokens and existing component patterns; no global theme changes.
- Write each test first, observe it fail, then implement the smallest change that passes.

## Review Focus

- Cursor boundaries with nicknames that sort next to one another — server test checks no gaps or duplicates across pages.
- Search and class filter combined, including no matches — server and UI tests check all matching pages and the correct empty state.
- Invalid cursor, class, and long search input — server contract tests check rejection without returning profile data.
- Roster exceeds the former 250-row safety limit — page test checks the new operation continues beyond that boundary; the legacy operation keeps its explicit truncation.
- Desktop/tablet/phone layout and assets under GitHub Pages paths — UI/e2e checks cover responsive columns, scroll ownership, and no horizontal overflow.

---

### Task 1: Add a filtered cursor page operation

**Files:**

- Modify: `supabase/functions/_shared/contracts/roster.ts`
- Modify: `supabase/functions/_shared/roster/repository.ts`
- Modify: `supabase/functions/_shared/roster/service.ts`
- Modify: `supabase/functions/_shared/app.ts`
- Test: `tests/server/roster.test.ts`

**Interfaces:**

- Add `rosterPageRequestSchema` with optional cursor, optional positive `classId`, and trimmed optional search text (maximum 100 characters).
- Add `RosterPageResponse = Page<RosterMember>` and `listRosterPage(deps, actor, body)`.
- Fix page size at 24; query one extra row and build `nextCursor` from `(game_nickname, id)`.
- Keep `listRoster` and `RosterListResponse` unchanged.

- [x] **Step 1: Write failing server tests** for authorization (internal roles only), class and case-insensitive nickname/class search, combined filters, 24-row cursor paging with no gaps/duplicates, closed-field omission, invalid input, and route registration in the shared API dispatcher.
- [x] **Step 2: Run the focused server test** with `npm run test:server -- tests/server/roster.test.ts`; confirm the new route/service tests fail before implementation.
- [x] **Step 3: Implement the contract, repository filters, service operation, and `roster/page` dispatch**. Escape SQL pattern metacharacters in search text; use the existing `nicknameCursor`, `splitPage`, and `toCards` helpers.
- [x] **Step 4: Run the focused server test** and confirm the new tests pass while the old `roster/list` tests remain unchanged.
- [x] **Step 5: Commit** `feat(roster): add filtered cursor pages`.

### Task 2: Load roster pages by server-side search and class filter

**Files:**

- Modify: `src/features/roster/api.ts`
- Modify: `src/features/roster/query-keys.ts`
- Modify: `src/features/roster/roster-page.tsx`
- Test: `tests/roster-admin.test.tsx`

**Interfaces:**

- Add `useRosterPages({ classId, search })`, keyed by normalized filters and using `useInfiniteQuery` with `cursor` and 24-item responses.
- Flatten received pages for rendering; trigger the next fetch from the existing paging helpers.
- Preserve the `useRoster` hook for every screen outside the member tab.

- [x] **Step 1: Write failing UI tests** for server request filters, empty states, continued loading, and preservation of role-specific card actions. Initial request errors keep the shared retry state.
- [x] **Step 2: Run `npx vitest run tests/roster-admin.test.tsx`**; confirm the new tests fail on the old whole-roster hook.
- [x] **Step 3: Implement the paged query and connect only the member tab**. Debounce search input to avoid a server call on each keystroke; changing filters starts a fresh cursor sequence.
- [x] **Step 4: Run the focused UI tests** and confirm home/rating still use `useRoster`.
- [x] **Step 5: Commit** `feat(roster): page the member roster`.

### Task 3: Add fixed class art and the responsive virtualized grid

**Files:**

- Create: `src/assets/roster-backgrounds/{17 class}-v1.webp` (one file per class from the updated archive)
- Create: `src/features/roster/backgrounds.ts`
- Modify: `src/features/roster/roster-page.tsx`
- Modify: `src/components/virtual-list.tsx`
- Test: `tests/roster-admin.test.tsx`
- Test: `tests/virtual-list.test.tsx`

**Interfaces:**

- Export `rosterBackgroundForClass(classId: number): string | undefined` from the roster asset map.
- Extend `ScrollableVirtualList` to group cards into responsive grid rows while keeping its own scroll container; use the same base/sm/lg column counts as its CSS grid.
- Use window-scrolling `VirtualList` on one-column phones and `ScrollableVirtualList` for two/three-column tablet and desktop layouts.

- [x] **Step 1: Write failing tests** for same-class fixed backgrounds, 17 class mappings, virtualized grid row grouping at one/two/three columns, desktop internal scrolling, and phone page scrolling.
- [x] **Step 2: Run the focused UI/component tests**; confirm they fail for missing assets and single-column internal lists.
- [x] **Step 3: Add the 17 `v1` WebP assets and background map**. Do not copy the archive's sample avatars, demo data, or empty slots.
- [x] **Step 4: Implement the roster card look**: dark/gold theme-token surfaces, scene image behind live HTML text, readable overlay, current profile avatar/letter fallback, existing five stats and actions. Keep the background constant for all members of a class.
- [x] **Step 5: Extend responsive virtualized grid rendering** and switch between internal scroll on tablet/desktop and page scroll on phones. Use lazy image loading and the existing reduced-motion behavior.
- [x] **Step 6: Run focused roster and virtual-list tests**; confirm 3/2/1 columns, fixed class art and scroll behavior.
- [x] **Step 7: Commit** `feat(roster): add class art cards`.

### Task 4: Verify the complete feature and its docs

**Files:**

- Modify: `e2e/roster.spec.ts`
- Modify: `docs/requirements/10-roster.md`
- Modify: `docs/requirements/17-open-questions.md`
- Modify: `docs/architecture/lists.md`
- Modify: `docs/architecture/module-decisions.md`

- [x] **Step 1: Add Playwright coverage** for scrolling beyond the first 24 members on desktop and phone, checking class/search filters across pages, fixed class art, and no horizontal overflow. Do not run e2e locally; CI runs it during step 6.
- [x] **Step 2: Run `npm run check:quick`** and fix all reported errors.
- [x] **Step 3: Run `npm run test:server`** and fix all server failures.
- [x] **Step 4: Review requirements, list registry, module decisions, and e2e scenarios** for agreement with the approved design.
- [x] **Step 5: Commit** remaining implementation/doc changes using Conventional Commits.

## Implementation Self-Review

- The API addition is a new operation, so deployed older clients can continue using `roster/list` while the member tab uses `roster/page`.
- The fixed background is selected by `classId`, never by member ID, nickname, role, or list position.
- After manual review, align the scene to the right edge for archer, paladin, bard, mystic, guard, and blood-spirit cards so the main figure remains in view at card proportions.
- Existing data, permissions, role changes, audit entries, notifications, homepage and event/group/rating list consumers stay on existing paths.
- Search and class filter are included in query keys and server requests; new filter values begin at a fresh cursor.
- Legacy end-to-end scenarios now wait for and scroll the desktop roster's own list area, or the page on phones, while loading cursor pages; they no longer expect all members in the first response.
- E2E is added but not run locally; `npm run test:server` is run before step 4, and `npm run review:prepare` will reset local data before the manual review.
