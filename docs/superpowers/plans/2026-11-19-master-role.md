# Master Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the internal role «Мастер», give it officer permissions, and let it assign four approved roles to ordinary members and readers from «Состав клана».

**Architecture:** Extend the existing `profiles.access_role` constraint and shared role contracts with `master`. Add `master` to the same officer permission groups across client navigation and server operations, while keeping admin-only account management restricted. Reuse `accounts/set-role` for the master’s narrower roster actions, with server-side target and destination checks.

**Tech Stack:** TypeScript strict, React 19, TanStack Router/Query, zod, Supabase Edge Function, Postgres, Vitest, pgTAP, Playwright.

**Spec:** [2026-11-19-master-role-design.md](../specs/2026-11-19-master-role-design.md)

## Global Constraints

- Work only in `main`; do not create branches or worktrees.
- Client is React 19 + Vite on GitHub Pages; backend is the single Supabase Edge Function `api`.
- Use only existing dependencies and Supabase Free services.
- Every server operation checks the actor’s role and target; hiding a button is not authorization.
- Keep role changes transactional; write audit and notification with the change.
- Candidate accounts with an active application can change role only through the existing application decision flow.
- Migrations are forward-only; deploy migration and function before the client.
- Do not run Playwright e2e locally; CI runs it after the owner accepts manual review.

## Review Focus

- A master receives every officer capability but never sees or calls admin-only account management or the action journal.
- A master can change only a `member` or `reader` target, and only to `member`, `officer`, `reader`, or `applicant`; officer, master, and admin targets and master/admin destinations are forbidden by the server.
- A target with an active application remains unchanged and returns `application_pending`, including a requested role of `applicant`.
- Reader restoration, date-of-entry rules, notification, audit, and idempotent same-role behavior remain consistent with the existing operation.
- Role changes update current access, roster totals, role labels, notification access, and desktop/mobile roster actions without changing historical snapshots.

---

### Task 1: Persist the new role safely

**Files:**

- Create: `supabase/migrations/20261119130000_master_role.sql`
- Create: `supabase/tests/database/stage18_master_role.test.sql`
- Modify: `docs/architecture/database-schema-proposal.md` (already updated with requirements)

**Interfaces:**

- The existing `app.profiles.access_role` column accepts `master` while retaining all current values and the `is_primary_admin` constraint.
- No new table, column, or database function is introduced.

- [ ] **Step 1: Add the failing pgTAP assertions.** Verify an account can be inserted with `access_role = 'master'` and an unsupported role still violates the role constraint.
- [ ] **Step 2: Run the focused database test and confirm it fails before the migration.** Run `npm run supabase:test`.
- [ ] **Step 3: Add the forward migration.** Replace the role check constraint with the same accepted role set plus `master`; leave all other constraints untouched.
- [ ] **Step 4: Run database tests and confirm the assertions pass.** Run `npm run supabase:test`.

### Task 2: Add master to shared role types and client access

**Files:**

- Modify: `supabase/functions/_shared/contracts/account.ts`
- Modify: `supabase/functions/_shared/contracts/accounts.ts`
- Modify: `supabase/functions/_shared/contracts/notifications.ts`
- Modify: `src/app/access.tsx`
- Modify: `src/app/navigation.ts` only if a direct role check is needed
- Modify: `src/features/account/status-labels.ts`
- Modify: `src/features/notifications/notification-target.ts`
- Modify: `src/features/notifications/notification-bell.tsx`
- Modify: `src/features/discussions/discussion-thread.tsx`
- Modify: `src/features/admin/accounts-table.tsx`
- Modify: `tests/access.test.tsx`, `tests/navigation.test.ts`, `tests/notifications.test.tsx`, `tests/admin-accounts-filters.test.tsx`

**Interfaces:**

- Add `master` to shared `AccessRole`, the server `ACCESS_ROLES` schema, client `ACCESS_ROLES`, `INTERNAL_ROLES`, and `MANAGER_ROLES`.
- Add `ROLE_LABELS.master = 'Мастер'` and the status label used for account display.
- Keep `ADMIN_ROLES` as `['admin']`; the administrator’s account selector includes `master`.
- Give master the same notification bell, internal sections, management sections, and application news count as officer. The `accounts` news section remains admin-only.

- [ ] **Step 1: Add failing client tests.** Assert master sees every officer navigation section except «Администрирование», has officer-level route access, sees the «Мастер» label and bell, receives the applications count but not the accounts count, and the admin role selector includes master.
- [ ] **Step 2: Run the focused tests and confirm they fail.** Run `npx vitest run tests/access.test.tsx tests/navigation.test.ts tests/notifications.test.tsx tests/admin-accounts-filters.test.tsx`.
- [ ] **Step 3: Extend shared and client role types and access lists.** Preserve `ADMIN_ROLES` as admin-only and add master only to officer-equivalent sets.
- [ ] **Step 4: Run the focused tests and confirm they pass.** Repeat the command from Step 2.

### Task 3: Enforce officer-equivalent rights and narrow role assignment on the server

**Files:**

- Modify: `supabase/functions/_shared/membership.ts`
- Modify: `supabase/functions/_shared/accounts/service.ts`
- Modify: `supabase/functions/_shared/accounts/repository.ts`
- Modify: `supabase/functions/_shared/account/service.ts`
- Modify: `supabase/functions/_shared/applications/service.ts`
- Modify: `supabase/functions/_shared/activity/service.ts`
- Modify: `supabase/functions/_shared/broadcasts/service.ts`
- Modify: `supabase/functions/_shared/discussions/service.ts`
- Modify: `supabase/functions/_shared/contracts/discussions.ts`
- Modify: `supabase/functions/_shared/events/service.ts`
- Modify: `supabase/functions/_shared/groups/service.ts`
- Modify: `supabase/functions/_shared/market/service.ts`
- Modify: `supabase/functions/_shared/publications/service.ts`
- Modify: `supabase/functions/_shared/roster/service.ts`
- Modify: `supabase/functions/_shared/votes/service.ts`
- Modify: `supabase/functions/_shared/contracts/roster.ts`
- Modify: `tests/server/accounts.test.ts`, `tests/server/account.test.ts`, `tests/server/applications.test.ts`, `tests/server/activity.test.ts`, `tests/server/broadcasts.test.ts`, `tests/server/discussions.test.ts`, `tests/server/events.test.ts`, `tests/server/groups.test.ts`, `tests/server/market.test.ts`, `tests/server/notifications.test.ts`, `tests/server/publications.test.ts`, `tests/server/roster.test.ts`, `tests/server/votes.test.ts`

**Interfaces:**

- Server role groups treat `master` as internal and officer-equivalent; administrator-only account listing, profile editing, deletion, and audit listing remain admin-only.
- `accounts/set-role`: admins retain existing full role management. Officers retain only member-to-reader. Masters may change only member or reader targets, and only to `member`, `officer`, `reader`, or `applicant`. All actors remain subject to the active-application guard, pending deletion guard, audit, notification, and date rules.
- Reader listing and restoration include master, matching officer rights.
- Discussion role badges and roster count/role ordering support `master`.

- [ ] **Step 1: Add failing server tests.** In `accounts.test.ts`, add `lets masters change only member and reader roles`, `rejects master role changes to officer, master, and admin targets`, `rejects master and admin role destinations`, and `keeps active applications and deletion-pending accounts protected`. Update each officer-only service test in the listed suites to exercise both `officer` and `master` for its existing authorized operation; keep admin-only negative cases unchanged.
- [ ] **Step 2: Run focused server tests and confirm they fail.** Run `npm run test:server -- tests/server/accounts.test.ts tests/server/account.test.ts tests/server/applications.test.ts tests/server/activity.test.ts tests/server/broadcasts.test.ts tests/server/discussions.test.ts tests/server/events.test.ts tests/server/groups.test.ts tests/server/market.test.ts tests/server/notifications.test.ts tests/server/publications.test.ts tests/server/roster.test.ts tests/server/votes.test.ts`.
- [ ] **Step 3: Add master to officer permission checks.** Update explicit officer/admin role lists and role equality checks; leave admin-only checks unchanged.
- [ ] **Step 4: Apply the master-specific `accounts/set-role` policy.** Retain the officer member-to-reader rule and admin full-management behavior; reject unauthorized targets or destination roles with `forbidden` and retain `application_pending` for an active application.
- [ ] **Step 5: Run focused server tests and confirm they pass.** Repeat the command from Step 2.

### Task 4: Add roster role controls and local master fixture

**Files:**

- Modify: `src/features/roster/roster-page.tsx`
- Modify: `src/features/roster/api.ts` and `src/features/admin/api.ts` only as required for existing cache invalidation
- Modify: `src/features/discussions/discussion-thread.tsx`
- Modify: `scripts/seed-dev.ts`
- Modify: `tests/roster-admin.test.tsx`
- Modify: `e2e/roster.spec.ts`

**Interfaces:**

- A master sees a role-selection action for ordinary members and the same action for reader cards on the «Чтецы» tab. Officers retain the current reader-only action; admins retain their existing behavior. Reader-to-member uses the existing restore operation so its date and `reader_restored` audit semantics remain unchanged; the other new transitions use `accounts/set-role`.
- The confirmation names the target nickname and chosen role. Cancel leaves data unchanged; mutation errors keep the current card and display the existing error message.
- After success, invalidate role, roster, reader, count, notification, and audit queries using existing query keys.
- Seed `seed-master@example.test` with role `master` and include master among officer-equivalent users for local checks.

- [ ] **Step 1: Add failing component tests.** Cover menu visibility, all four role choices for member and reader targets, confirmation/cancel, successful updates, errors, and unchanged officer/admin behavior.
- [ ] **Step 2: Run the focused component test and confirm it fails.** Run `npx vitest run tests/roster-admin.test.tsx`.
- [ ] **Step 3: Implement the role picker and confirmation in roster cards.** Reuse existing role mutation and error handling; do not expose closed account fields or horizontal scrolling on mobile.
- [ ] **Step 4: Add the master seed account and update the admin account role selector.** Keep the seeded test password unchanged and local-only.
- [ ] **Step 5: Run the focused component test and confirm it passes.** Run `npx vitest run tests/roster-admin.test.tsx`.
- [ ] **Step 6: Add E2E-15.** In `e2e/roster.spec.ts`, assign master as admin, verify officer-equivalent access but no admin section, change a member and reader role, verify protected targets and active applications are rejected, and verify audit/notification. CI runs this scenario; do not run e2e locally.

### Task 5: Full verification and review handoff

**Files:**

- Modify: `docs/requirements/01-roles.md`, `docs/requirements/10-roster.md`, and `docs/requirements/15-admin.md` status tables after implementation
- Modify: `docs/requirements/README.md` E2E-15 implementation reference

- [ ] **Step 1: Run `npm run test:server`.** Confirm all server tests pass.
- [ ] **Step 2: Run `npm run supabase:test`.** Confirm all pgTAP tests pass.
- [ ] **Step 3: Run `npm run check:quick`.** Confirm secrets, styles, architecture, formatting, lint, types, and affected Vitest tests pass.
- [ ] **Step 4: Run `npm run security:check` and inspect the complete staged diff.** Confirm no secrets and no unrelated changes.
- [ ] **Step 5: Save implementation as a Conventional Commit in `main`.** Do not push; the owner must review through the local site first.
- [ ] **Step 6: Prepare manual review.** Run `npm run review:prepare`; start background `npm run e2e:functions` and `npm run dev` if not already running; provide local links and test credentials, including `seed-master@example.test`, and ask for acceptance or remarks.

## Separate saves required by the project workflow

- Requirements and owner decision: `docs(requirements): add master role`.
- Design and implementation plan: a separate documentation commit before implementation.
- Code, migration, and tests: a separate Conventional Commit after required checks.
- Push and release occur only after the owner accepts the local review.
