# Multi-Class Roster Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make roster distribution chips filter the member list by any combination of selected classes while preserving the all-roster statistics.

**Architecture:** Store selected class IDs in the roster URL and TanStack Query key. Extend the existing `roster/page` request compatibly with an optional `classIds` array while retaining `classId` for older clients. Apply the class selection and text search together in the existing server-side cursor query; render distribution chips as accessible toggle buttons.

**Tech Stack:** React 19, TanStack Router/Query, TypeScript, Zod, Supabase Edge Function, Kysely, Vitest.

**Spec:** `docs/requirements/10-roster.md` (ROS-04, ROS-05, ROS-14); decision in `docs/requirements/17-open-questions.md`.

## Global Constraints

- Preserve all current role and data visibility rules.
- Keep the existing 24-row cursor paging, order, virtualization, and empty states.
- Keep new request fields optional and preserve support for the old singular `classId` request.
- Keep the shared statistics unchanged when classes are selected.
- Use the existing React, Router, Query, Zod, Tailwind, and Supabase patterns.

## Review Focus

- No selected class IDs means no class filter and all members are returned.
- Multiple IDs return the union of those classes; text search intersects with that result.
- Paging cursors and query caches stay separate for different selections.
- Old singular `classId` calls continue to work.
- Empty results and narrow layouts remain usable; toggle state is exposed to assistive technology.

## Files

- Modify `src/features/roster/roster-page.tsx` for URL state and accessible statistic-chip toggles.
- Modify `src/features/roster/api.ts` and `src/features/roster/query-keys.ts` for multi-ID request and cache identity.
- Modify `supabase/functions/_shared/contracts/roster.ts`, `roster/service.ts`, and `roster/repository.ts` for validation and server-side union filtering.
- Modify `tests/roster-admin.test.tsx` and `tests/server/roster.test.ts` to cover UI, URL restoration, compatibility, and server filtering.
- Modify `e2e/roster.spec.ts` to cover real browser selection and clearing.

## Tasks

### Task 1: Request contract and server filter

**Files:** contract, roster service/repository, `tests/server/roster.test.ts`.

- [ ] Add optional `classIds` to the page request contract; keep optional singular `classId`.
- [ ] Add server tests for zero, one, and multiple IDs, search intersection, and legacy `classId`.
- [ ] Run the focused server test and confirm the new cases fail before implementation.
- [ ] Apply the class filter with SQL `IN` for `classIds`, falling back to `classId` for legacy callers.
- [ ] Run the focused server test and confirm all cases pass.

### Task 2: URL state, cache, and statistic toggles

**Files:** `roster-page.tsx`, `api.ts`, `query-keys.ts`, `tests/roster-admin.test.tsx`.

- [ ] Add multi-value `classIds` URL parsing while accepting old singular `classId` links.
- [ ] Add UI tests for selecting multiple chips, deselecting the final chip, search intersection, and URL restoration.
- [ ] Run the focused UI tests and confirm the new cases fail before implementation.
- [ ] Make chips accessible toggle buttons with selected-state styling; remove the redundant single-class selector.
- [ ] Send selected IDs in `roster/page`; ensure cache keys distinguish selections; keep stats request unfiltered.
- [ ] Run the focused UI tests and confirm all cases pass.

### Task 3: End-to-end coverage and project checks

**Files:** `e2e/roster.spec.ts`.

- [ ] Add browser coverage for selecting two classes, checking only matching members, clearing filters, and checking narrow layout.
- [ ] Run `npm run check:quick` and `npm run test:server`.
- [ ] Prepare the local review stack, then present the roster page for manual review; e2e is run only in CI during the final release step.

### Task 4: Commits

- [ ] Commit the plan separately before implementation.
- [ ] Commit implementation as a Conventional Commit on `main`; do not push before the review and acceptance steps.
