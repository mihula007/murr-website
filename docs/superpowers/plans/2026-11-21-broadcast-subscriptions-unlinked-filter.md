# Фильтр подписок без привязки Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a «Показать без подписки» checkbox that filters the subscriptions roster to profiles with no link to Telegram, VK, or MAX.

**Architecture:** Keep the existing read-only subscriptions operation and add an optional boolean filter to its zod request contract. Apply it in the repository query before cursor pagination, and keep the checkbox/search in the route and query keys so every page represents the same result.

**Tech Stack:** TypeScript strict, React 19, TanStack Router, TanStack Query, zod, Kysely, Supabase Edge Function, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-broadcast-subscriptions-unlinked-filter-design.md`

## Global Constraints

- Use Node.js 24 from the version manager selected by `.nvmrc`; install with `npm clean-install` only when the lockfile or Node version changes.
- All server reads and writes go through the existing single `api` Edge Function; browser calls use `callApi`.
- Use zod for request validation and shared contracts under `supabase/functions/_shared/contracts/`.
- Keep the existing cursor `(game_nickname, id)` and `ScrollableVirtualList`; do not add a dependency or database migration.
- Search and filters for lists over 50 entries run on the server and are saved in route search parameters.
- Roles and the read-only nature of the subscriptions tab remain unchanged; no audit entry or notification is added.

## Review Focus

- A blocked messenger link still counts as a link and must not appear in the filtered result.
- A profile with no links to any of the three messengers appears when the filter is enabled.
- Nickname search and the filter combine, including when fetching subsequent cursor pages.
- Changing the filter starts from the first page; the selected value survives refresh/back navigation through route search.
- An empty filtered result shows «Людей без привязки не нашли» and the unchanged default view still shows all internal profiles.

---

### Task 1: Filter the server-side subscription pages

**Files:**

- Modify: `supabase/functions/_shared/contracts/broadcasts.ts`
- Modify: `supabase/functions/_shared/broadcasts/service.ts`
- Modify: `supabase/functions/_shared/broadcasts/repository.ts`
- Test: `tests/server/broadcasts.test.ts`

**Interfaces:**

- Request: `broadcasts/subscriptions` accepts optional `unlinkedOnly?: boolean`; omitted or false keeps current behavior.
- Repository: `SubscriptionPageOptions` receives `unlinkedOnly: boolean`; when true, require all three link rows to be absent before applying cursor and limit.
- Response: unchanged `BroadcastSubscriptionsResponse`.

- [x] **Step 1: Write a failing server test**
  - Verify default request returns both linked and unlinked internal profiles.
  - Verify `unlinkedOnly: true` returns only profiles with no Telegram, VK, or MAX link; a blocked link counts as linked.
  - Verify nickname search and the cursor continue to apply after the unlinked filter.
- [x] **Step 2: Run the server test and confirm it fails**
  - Run: `npm run test:server`
  - Expected: the test fails because the request currently ignores `unlinkedOnly`.
- [x] **Step 3: Implement the optional contract, service parameter, and repository predicate**
  - Add the boolean to `broadcastSubscriptionsSchema` with a false default.
  - Pass it through `listBroadcastSubscriptions` and filter the three left joins before cursor paging.
- [x] **Step 4: Run the server test and confirm it passes**
  - Run: `npm run test:server`
  - Expected: all server tests pass.

### Task 2: Add the checkbox and cover the full flow

**Files:**

- Modify: `src/features/broadcast/broadcast-page.tsx`
- Modify: `src/features/broadcast/api.ts`
- Modify: `src/features/broadcast/subscriptions-panel.tsx`
- Test: `tests/broadcast.test.tsx`
- Test: `e2e/broadcast.spec.ts`

**Interfaces:**

- Route search: add `unlinkedOnly`, default false; preserve `q` and `tab` when it changes.
- Query: `broadcastKeys.subscriptions(search, unlinkedOnly)` and `useBroadcastSubscriptions(search, unlinkedOnly)` distinguish filter states and send the option to `broadcasts/subscriptions`.
- Panel: receive controlled `unlinkedOnly` and `onUnlinkedOnlyChange`; render checkbox «Показать без подписки».

- [x] **Step 1: Write failing component tests**
  - Verify the checkbox is unchecked by default, checking it updates the address and sends `unlinkedOnly: true`, and nickname search is retained.
  - Verify an empty filtered result shows «Людей без привязки не нашли».
- [x] **Step 2: Run the component test and confirm it fails**
  - Run: `npm run check:quick`
  - Expected: the new component tests fail because no filter exists yet.
- [x] **Step 3: Implement route state, query key/request, and checkbox**
  - Keep search and filter controlled by the route; changing either creates a fresh first-page query.
  - Keep existing roles, list rows, mobile cards, and unfiltered empty states unchanged.
- [x] **Step 4: Run the component test and confirm it passes**
  - Run: `npm run check:quick`
  - Expected: all quick checks pass.
- [x] **Step 5: Add a Playwright scenario to `e2e/broadcast.spec.ts`**
  - Verify enabling the checkbox leaves only profiles without any messenger link and that the checkbox state remains after reload.
  - Do not run E2E locally; CI runs the full E2E suite at release.

### Task 3: Verify and prepare the manual review

**Files:**

- Verify: `docs/requirements/14-broadcast.md`, `docs/requirements/17-open-questions.md`, `docs/architecture/lists.md`, `docs/architecture/module-decisions.md`
- Verify: all files in Tasks 1 and 2
- Modify: `scripts/seed-dev.ts` (local review data: completed vote applications use valid final statuses)

- [x] **Step 1: Run the required checks**
  - Run: `npm run check:quick`
  - Run: `npm run test:server`
  - Expected: both commands pass; no pgTAP run is needed because the database schema does not change.
- [x] **Step 2: Save the implementation in one Conventional Commit**
  - Commit message: `feat(broadcast): filter unlinked subscriptions`
- [x] **Step 3: Prepare the local review after tests**
  - The local seed data uses `admin_approved` or `admin_rejected` for completed application votes, as required by the database status rule; this is only demo data.
  - Run `npm run review:prepare`, then start the background processes required by project instructions and provide the review URL and checks.
