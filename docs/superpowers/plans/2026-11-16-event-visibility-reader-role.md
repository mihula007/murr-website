# Event Visibility and Reader Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members see only their own assigned event group while officers can assign ordinary members the reader role from the roster.

**Architecture:** Filter event people and groups in the existing server event detail service according to the viewer's role; keep the existing event page and hide the pool for members. Extend the existing account role operation so officers may only change `member → reader`, and expose the existing confirmed roster action to officers.

**Tech Stack:** TypeScript strict, React 19, TanStack Query, one Supabase Edge Function (`api`), Postgres, Vitest, Playwright.

**Spec:** [2026-11-16-event-visibility-reader-role-design.md](../specs/2026-11-16-event-visibility-reader-role-design.md)

## Global Constraints

- Development stays on `main`; do not create branches or worktrees.
- Keep the existing React/Vite client and single Supabase Edge Function; add no dependency, table, or migration.
- Enforce permissions in the server operation as well as the user interface.
- Preserve existing event, attendance, group, account, and activity data.
- Keep role notifications and audit entries in the existing transaction flow.
- Do not run e2e locally; CI runs all Playwright scenarios after the owner accepts the local review.

## Review Focus

- A member assigned to a group receives only that group and its people from the event detail operation, while retaining their own answer and aggregate counts.
- A member with no group receives empty people/group lists and the exact message `Вы пока не распределены по группе`.
- The same visibility applies to archived events; officers and administrators still receive the complete historical roster.
- An officer can change only a `member` to `reader`; direct attempts to change any other role remain forbidden, and the existing audit and role notification are written.
- The roster action appears for officers and administrators only on ordinary members, requires confirmation, and behaves on narrow screens through the existing card menu.

---

### Task 1: Restrict event details for members

**Files:**
- Modify: `supabase/functions/_shared/events/service.ts`
- Modify: `src/features/events/groups/event-groups.tsx`
- Test: `tests/server/events.test.ts`
- Test: `tests/events.test.tsx`
- Test: `e2e/events.spec.ts`

**Interfaces:**
- Consume `EventDetails` and existing `getEvent(deps, actor, body)`; do not add a new operation or response field.
- Members receive `participants` filtered to IDs in their assigned group and `groups` containing only that group. With no assignment, both arrays are empty. `myAnswer` and `counts` remain unchanged.
- Officers and administrators continue to receive unfiltered `participants` and `groups` for active and closed events.

- [ ] **Step 1: Write the failing server tests** in `tests/server/events.test.ts`:
  - `limits member event details to their assigned group and retains aggregate summary` asserts a member gets only their group and its participants, while their answer and aggregate counts remain intact; also assert the officer response remains complete.
  - `limits member event details for a closed event without changing officer history` asserts the same restriction for archived groups and participants and the complete archived response for an administrator.
  - `returns no groups or participants for an unassigned member` asserts empty arrays and unchanged answer/counts.
- [ ] **Step 2: Run the server tests to confirm the new assertions fail** because `getEvent` currently returns every group and participant to members.
- [ ] **Step 3: Implement role-specific filtering in `loadEventDetails`** in `supabase/functions/_shared/events/service.ts`. Filter `groups` by whether they contain `viewer.userId`; filter `participants` by the selected group's member IDs. Keep summary, counts, and the existing response contract.
- [ ] **Step 4: Run `npm run test:server`** and confirm event access and existing server behaviors pass.
- [ ] **Step 5: Write the failing page tests** in `tests/events.test.tsx`:
  - `shows only the assigned group and hides the attendee pool for a member` asserts no answer tabs or other groups appear.
  - `shows the unassigned message for a member without a group` asserts exact copy and no attendee list.
  - Update the existing `lists participants by answer` coverage to use the officer role, preserving its full-view assertion.
- [ ] **Step 6: Run `npx vitest run tests/events.test.tsx`** and confirm the new member-view tests fail before the page change.
- [ ] **Step 7: Update `EventGroupsSection`** in `src/features/events/groups/event-groups.tsx` to hide the free attendee pool for members, show only the returned own group, and show the approved empty-state copy when there is no group. Preserve the existing full view for officers and administrators, including closed events.
- [ ] **Step 8: Run `npx vitest run tests/events.test.tsx tests/event-groups.test.tsx`** and confirm the member and manager views pass.
- [ ] **Step 9: Add Playwright coverage** in `e2e/events.spec.ts` named `member sees only their assigned group while managers retain the full event roster`; cover an assigned member, an unassigned member, and manager access to the archived event. Do not run e2e locally.

### Task 2: Let officers assign members the reader role

**Files:**
- Modify: `supabase/functions/_shared/accounts/service.ts`
- Modify: `src/features/roster/roster-page.tsx`
- Test: `tests/server/accounts.test.ts`
- Test: `tests/roster-admin.test.tsx`
- Create: `e2e/roster.spec.ts`

**Interfaces:**
- Reuse `accounts/set-role`, `applyRole`, existing `ROLE_AUDIT`, audit, and notification behavior.
- Officers may call the operation only for `role: 'reader'` when the target's current role is `member`; administrators retain the existing operation.
- Reuse the existing confirmation dialog and roster card action; no new control or role is introduced.

- [ ] **Step 1: Write the failing service tests** in `tests/server/accounts.test.ts`:
  - `lets officers assign members the reader role with audit and notification` asserts role becomes reader, membership date and account remain, audit is written, notification is created, and roster access is lost.
  - `forbids officers from changing roles other than member to reader` asserts attempts against officer, admin, reader, or applicant targets and attempts to assign other roles are rejected with no role change, audit, or notification.
  - Keep the existing administrator role-change tests passing unchanged.
- [ ] **Step 2: Run `npm run test:server`** to confirm the new officer tests fail because `setRole` currently accepts administrators only.
- [ ] **Step 3: Update `setRole`** in `supabase/functions/_shared/accounts/service.ts`: authorize officers and administrators, then reject an officer unless the requested transition is exactly member to reader. Pass the authorized actor to the existing transactional `applyRole` path so audit and notification remain atomic.
- [ ] **Step 4: Run `npm run test:server`** and confirm allowed and forbidden role changes pass.
- [ ] **Step 5: Write the failing roster test** in `tests/roster-admin.test.tsx` named `lets an officer assign only ordinary members as readers after confirmation`; assert the menu is available on a member card, the existing confirmation appears, and confirmation calls `accounts/set-role` with `{ userId, role: 'reader' }`. Preserve existing no-action coverage for a member viewer.
- [ ] **Step 6: Run `npx vitest run tests/roster-admin.test.tsx`** and confirm the officer action assertion fails before the page change.
- [ ] **Step 7: Update `RosterPage` and `MembersList`** in `src/features/roster/roster-page.tsx` to show the existing member-card action to officers as well as administrators. Keep the target filter limited to `member` and retain the confirmation and toast.
- [ ] **Step 8: Run `npx vitest run tests/roster-admin.test.tsx`** and confirm officer, administrator, and member views pass.
- [ ] **Step 9: Add Playwright coverage** in `e2e/roster.spec.ts` named `officer assigns a member the reader role from the roster`; confirm the user loses internal access and the account remains. Do not run e2e locally.

### Task 3: Verify and save the implementation

**Files:**
- Modify: `docs/requirements/README.md` to link E2E-13 to the event and roster browser scenarios.

- [ ] **Step 1: Run the required checks**: `npm run test:server`, then `npm run check:quick`.
- [ ] **Step 2: Inspect all changed files and run `git diff --check`**; fix any check failures before saving.
- [ ] **Step 3: Run `npm run security:check`** and confirm no known secrets are present.
- [ ] **Step 4: Save the implementation** in one Conventional Commit on `main`. Do not push; publishing is step 6 after the owner accepts the local review.
