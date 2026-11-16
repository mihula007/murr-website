# Broadcast Recipient Exclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let officers and administrators exclude selected people from every selected messenger channel for one announcement, while preserving existing audience rules.

**Architecture:** Extend the current `broadcasts/recipients` operation to return channel counts and a cursor page of unique eligible people, with server-side nickname search. Pass excluded profile IDs through the existing send contract and filter each channel's live recipient query before delivery; record the unique submitted exclusions in the existing send audit row. Keep exclusions in the form only.

**Tech Stack:** TypeScript strict, React 19, TanStack Query/Form, Zod, one Supabase Edge Function, Kysely, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-broadcast-recipient-exclusions-design.md`

## Global Constraints

- UI and documentation are in Russian; broadcast sending remains available only to officers and administrators.
- The client is static React/Vite; all recipient reads and writes go through `callApi` to the single Supabase Edge Function.
- Shared request/response contracts and validation use Zod in `supabase/functions/_shared/contracts/`.
- Large lists use server-side search, cursor pagination, `useInfiniteQuery`, and `VirtualList`; search runs on the server.
- All channel delivery eligibility is re-evaluated at send time; exclusions are keyed by profile ID and apply to all selected channels.
- Existing event, group, messenger-link, active-role, blocked-bot, and deletion filters remain in effect.
- No migration, new dependency, notification, persisted preference, draft/template field, or recipient nickname in audit is added.
- Keep the new send request field optional so an already published client sends as before.
- Use the existing small-screen card pattern; do not add horizontal scrolling.

## Review Focus

- More than 50 eligible people: cursor pages remain stable and search finds later names; prove in the recipients service test.
- One person linked in multiple selected channels: one list row and one unique exclusion, while channel delivery counts change independently; prove in contract/service and UI tests.
- Eligibility changes after list loading: send still applies active server-side role/link/event/group rules; prove in each affected channel delivery test.
- All eligible people excluded: send is refused with «После исключений получателей не осталось»; a genuinely empty event audience without exclusions keeps the all-answered reason; prove in the send service test.
- Older callers omit exclusions: send behavior remains unchanged; prove in the schema and send service tests.

---

### Task 1: Add paged eligible-recipient listing

**Files:**

- Modify: `supabase/functions/_shared/contracts/broadcasts.ts`
- Modify: `supabase/functions/_shared/broadcasts/repository.ts`
- Modify: `supabase/functions/_shared/broadcasts/service.ts`
- Modify: `tests/server/broadcasts.test.ts`

**Interfaces:**

- Extend the `broadcasts/recipients` request with selected `channels`, optional `search`, and standard cursor/limit fields, while continuing to accept the existing group/event request. Accept optional `excludedUserIds` for a fresh count check immediately before confirmation.
- Extend its response with a page of unique eligible `{ id, gameNickname, channels }` records and `nextCursor`; keep the existing per-channel counts and answered counts, calculated after supplied exclusions.
- The eligible page includes a person when at least one selected channel would currently deliver to them; `channels` names every active messenger link for that person. Search, source restrictions, active roles, and blocked links are applied in SQL before paging.

- [x] **Step 1: Write failing server tests** in `tests/server/broadcasts.test.ts` for officer/admin access, selected channel union (one profile linked to two channels is returned once), event responders omitted, group audience limited to group members, nickname search, cursor continuation after 50 records, and per-channel counts after exclusions.
- [x] **Step 2: Run the focused server tests** with `npm run test:server -- tests/server/broadcasts.test.ts`; confirm the new cases fail because the response is not paged and does not include eligible people.
- [x] **Step 3: Implement the shared recipient request/response schema and repository query** using nickname key `(game_nickname, id)` and the existing cursor helpers. Validate channel selections against `SENDABLE_CHANNELS` and deduplicate the union by profile ID.
- [x] **Step 4: Implement the service response** with the page and current per-channel counts; do not return email, messenger account IDs, or display names.
- [x] **Step 5: Run the focused server tests** and confirm all new recipients cases pass.

### Task 2: Show and manage exclusions in the form

**Files:**

- Modify: `src/features/broadcast/api.ts`
- Create: `src/features/broadcast/recipient-exclusions.tsx`
- Modify: `src/features/broadcast/broadcast-page.tsx`
- Modify: `tests/broadcast.test.tsx`

**Interfaces:**

- Add `useInfiniteQuery` for `broadcasts/recipients`, keyed by search, channels, group, and event; use `pagingOf` and `VirtualList`.
- `RecipientExclusions` consumes the paged eligible recipients and a `Set<string>` of excluded profile IDs; it reports checkbox changes by profile ID.
- Changing selected channels refreshes eligible recipients/counts but preserves exclusions for users who remain eligible.

- [x] **Step 1: Write failing component tests** in `tests/broadcast.test.tsx` for the default all-included state, toggling an exclusion, one row for a recipient with multiple selected channels, server search and page loading, and preserving checked state when the confirmation dialog is canceled.
- [x] **Step 2: Run `npm run test -- tests/broadcast.test.tsx`** and confirm the new UI cases fail because the form has no recipient list.
- [x] **Step 3: Implement the recipient list UI** with Russian labels, search by nickname, checkbox rows on wide screens, cards on narrow screens, loading/error/empty states, and the explanatory copy that one unchecked person is skipped across all chosen messengers.
- [x] **Step 4: Keep exclusions in form state only**; do not pass them to draft/template saves. Recalculate visible counts locally using each recipient's active channel list; before opening confirmation, refresh server counts with the excluded IDs.
- [x] **Step 5: Run the focused component tests** and confirm the new cases pass.

### Task 3: Apply exclusions during delivery and audit

**Files:**

- Modify: `supabase/functions/_shared/contracts/broadcasts.ts`
- Modify: `supabase/functions/_shared/broadcasts/service.ts`
- Modify: `supabase/functions/_shared/telegram/announcements.ts`
- Modify: `supabase/functions/_shared/max/announcements.ts`
- Modify: `supabase/functions/_shared/vk/announcements.ts`
- Modify: `src/features/broadcast/api.ts`
- Modify: `src/features/broadcast/broadcast-page.tsx`
- Modify: `tests/server/telegram-announcements.test.ts`
- Modify: `tests/server/max.test.ts`
- Modify: `tests/server/vk.test.ts`
- Modify: `tests/broadcast.test.tsx`

**Interfaces:**

- Add optional, unique `excludedUserIds` to both the recipient count request and `sendAnnouncementSchema`; reject malformed IDs and cap each list at `MEMBER_LIST_LIMIT`.
- Pass exclusions to each channel delivery function; filter by profile ID against each channel's fresh recipient query before sending.
- Add `excluded_recipients` to `broadcast_sent` audit details as the unique count of excluded profile IDs, without IDs or nicknames.

- [x] **Step 1: Write failing server tests** proving the excluded person receives nothing through Telegram, VK, and MAX; another selected channel still delivers to a person who is only linked there; all-channel counts exclude the skipped profile; event/group audience rules still apply; all excluded means refusal with «После исключений получателей не осталось»; and audit stores only the unique count.
- [x] **Step 2: Run the focused channel server tests** with `npm run test:server -- tests/server/telegram-announcements.test.ts tests/server/max.test.ts tests/server/vk.test.ts`; confirm the new cases fail because send ignores exclusions.
- [x] **Step 3: Implement optional excluded-ID validation and pass the set to all three delivery functions.** Each channel filters its current recipients by ID immediately before delivery; no caller-provided nickname or channel account ID is trusted.
- [x] **Step 4: Refuse when filtering leaves zero recipients across every selected channel** with «После исключений получателей не осталось» when exclusions caused the empty result; preserve the existing all-answered reason when no exclusions caused it. Write one audit entry with the number of unique excluded IDs and no member identities.
- [x] **Step 5: Send the form's exclusion IDs**, keep them after a canceled confirmation, and clear them with the form after successful sending.
- [x] **Step 6: Run the focused server and component tests** and confirm the new delivery, count, audit, and cancellation cases pass.

### Task 4: Cover the complete flow in end-to-end acceptance

**Files:**

- Modify: `e2e/broadcast.spec.ts`

- [x] **Step 1: Add an end-to-end case** that opens the broadcast form, searches for an eligible member, excludes them, confirms the remaining channel count, and verifies the request contains the excluded profile ID.
- [x] **Step 2: Check the test source and fixtures** for a stable seeded recipient and ensure the test does not depend on live Telegram/VK/MAX credentials.
- [x] **Step 3: Do not run e2e locally.** CI runs all e2e tests during the approved release step.

### Task 5: Run required local checks and save implementation

**Files:**

- Verify all changed files from Tasks 1–4.

- [x] **Step 1: Run `npm run test -- tests/broadcast.test.tsx`** and confirm all broadcast UI tests pass.
- [x] **Step 2: Run `npm run test:server`** and confirm server tests pass.
- [x] **Step 3: Run `npm run check:quick`** and confirm secrets, styles, architecture, formatting, lint, types, and changed-file Vitest checks pass.
- [x] **Step 4: Review the complete diff and stage only the intended implementation files.**
- [x] **Step 5: Commit once on `main`** with a Conventional Commit message such as `feat(broadcast): exclude recipients from one announcement`.

---

## Compatibility Notes

- No database migration is needed; exclusions are sent as part of the current request and are not stored.
- The new recipient page is manager-only and returns only profile ID, game nickname, and channel eligibility.
- An old client with no exclusion IDs continues to send to every currently eligible recipient.

## Follow-up from manual review (17.11.2026)

- Add a single-class server-side filter to the recipient options list; default to all classes. The filter changes only which people are visible, not who is in the announcement audience, and switching it preserves all checked/excluded IDs.
- Keep the recipient list in an internal scroll area sized for about 15 rows. Continue cursor pagination as the operator scrolls inside that area, and retain keyboard/screen-reader access and the narrow-screen card layout.
- Update the recipient list registry, BRC-16 acceptance, and the focused server/component coverage. Do not run the full check set during this remark pass; prepare the local app for manual validation.
