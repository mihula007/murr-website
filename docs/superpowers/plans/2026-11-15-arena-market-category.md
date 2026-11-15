# Категория «Арена» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить полноценную категорию «Арена» в объявления «Внутри клана».

**Architecture:** Расширить общий перечень категорий в общих проверках и подписях и совместимо обновить ограничение категорий в таблице рынка. Уже существующие объявления сохраняют свои данные; отдельная таблица и переписывание строк не нужны.

**Tech Stack:** TypeScript strict, React 19, Zod, Supabase Edge Function `api`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-arena-market-category-design.md`

## Global Constraints

- Разработка только в `main`, Node.js 24, React 19, TypeScript strict и существующие зависимости.
- Клиент и сервер используют одну Zod-схему и `MARKET_CATEGORIES` из `supabase/functions/_shared/contracts/market.ts`.
- Ограничение `market_listings.category` разрешает «Арену» и все пять прежних значений; старые строки не меняются.
- Все вызовы рынка идут через существующую `api`; новые таблицы, платные службы и переменные не добавляются.
- Доступ к рынку и правила черновиков остаются по MKT-01–07; существующие объявления не переписываются.

## Review Focus

- Старые пять категорий остаются допустимыми для чтения и изменения — проверка `tests/server/market.test.ts`.
- Новая категория проходит серверную проверку при сохранении — проверка `tests/server/market.test.ts`.
- Форма редактирования показывает сохранённую «Арену» — проверка `tests/materials.test.tsx`.
- Фильтр и поиск находят объявление «Арена» и не меняют другие категории — проверка `tests/materials.test.tsx`.
- Непривилегированные роли не получают новых прав — существующие проверки `tests/server/market.test.ts`.

---

### Task 1: Добавить категорию в общий контракт рынка

**Files:**

- Modify: `supabase/functions/_shared/contracts/market.ts`
- Modify: `tests/server/market.test.ts`

**Interfaces:**

- Produces: `MarketCategory` включает `'arena'`; `MARKET_CATEGORY_LABELS.arena` равно `Арена`; схемы чтения и сохранения принимают категорию.
- Consumes: существующие `MARKET_CATEGORIES`, `listMarketSchema` и `saveListingSchema`.

- [ ] **Step 1: Write the failing server contract test**

Добавьте `market listing accepts the arena category` и `market listing still rejects unknown categories`. Проверьте создание/изменение с `arena` и отказ неизвестного значения.

- [ ] **Step 2: Run the focused server test and verify it fails**

Run: `npm run test:server -- tests/server/market.test.ts`
Expected: FAIL because `arena` is not currently in `MARKET_CATEGORIES`.

- [ ] **Step 3: Implement the shared category**

Add `'arena'` to `MARKET_CATEGORIES` and `Арена` to `MARKET_CATEGORY_LABELS`; keep existing values unchanged.

- [ ] **Step 4: Run the focused server test**

Run: `npm run test:server -- tests/server/market.test.ts`
Expected: PASS; new and existing categories validate, unknown category remains rejected.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/contracts/market.ts tests/server/market.test.ts
git commit -m "feat(market): add arena category"
```

### Task 2: Verify create, edit, filter and search

**Files:**

- Modify: `tests/materials.test.tsx`
- Modify: `e2e/market.spec.ts`

**Interfaces:**

- Consumes: `marketSection.categories` and `marketSection.categoryLabels` derived from the shared market contract.
- Produces: coverage for the category editor, persisted label, market filter and search.

- [ ] **Step 1: Write failing UI tests**

In `tests/materials.test.tsx`, add `shows arena when creating and editing a market listing` and `filters and searches market listings by arena`. Verify the label is visible and the filter sends the arena category through the existing list query.

- [ ] **Step 2: Run the focused UI test and verify it fails**

Run: `npx vitest run tests/materials.test.tsx`
Expected: FAIL because the market category options do not yet include «Арена».

- [ ] **Step 3: Implement only where needed**

The common editor and feed derive their options from the market section contract. Make no changes to existing material storage or publication categories.

- [ ] **Step 4: Run the focused UI and server tests**

Run: `npx vitest run tests/materials.test.tsx`
Run: `npm run test:server -- tests/server/market.test.ts`
Expected: PASS.

### Task 3: Cover the owner flow and verify the change

**Files:**

- Modify: `e2e/market.spec.ts`

**Interfaces:**

- Consumes: existing market E2E helpers and category form.
- Produces: E2E-12 coverage for saving, editing, filtering and searching an «Арена» listing.

- [ ] **Step 1: Add the browser scenario**

Add `E2E-12: категория Арена при создании, изменении и поиске`: create and publish an Arena listing, edit and revisit it, then find it through the category filter and text search. Confirm an older listing remains unchanged.

- [ ] **Step 2: Keep e2e for CI**

Do not run the browser scenario locally. CI runs it during Step 6.

- [ ] **Step 3: Run the changed-file suite**

Run: `npm run check:quick`
Expected: PASS, including changed Vitest tests, lint, types, styles and architecture checks.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/contracts/market.ts tests/server/market.test.ts tests/materials.test.tsx e2e/market.spec.ts
git commit -m "feat(market): add arena category"
```

### Task 4: Разрешить «Арену» в базе данных

**Files:**

- Create: `supabase/migrations/20261115220000_market_arena_category.sql`
- Modify: `supabase/tests/database/stage8_publications_market.test.sql`
- Modify: `tests/server/market.test.ts`

**Interfaces:**

- Consumes: `MARKET_CATEGORIES` schema validation and existing market table.
- Produces: database accepts new `arena` listings and continues accepting prior categories without changing stored rows.

- [ ] **Step 1: Write the failing service test**

Add a server test that saves an `arena` listing, filters it from the feed, and confirms a prior `sale` listing keeps its category.

- [ ] **Step 2: Run the focused test and verify the database rejects Arena**

Run: `npm run test:server -- tests/server/market.test.ts`
Expected: FAIL with the existing database check constraint rejecting `arena`.

- [ ] **Step 3: Add a forward-only constraint migration and pgTAP coverage**

Replace only `market_listings_category_check` with the same five values plus `arena`. Extend the stage 8 pgTAP test to insert the new category; retain the unknown-category rejection and old-category fixtures.

- [ ] **Step 4: Apply and run focused backend checks**

Run: `npm run review:prepare`
Run: `npm run test:server -- tests/server/market.test.ts`
Run: `npm run supabase:test`
Expected: PASS; old rows and old category values remain valid.

- [ ] **Step 5: Run the required quick checks**

Run: `npm run check:quick`
Expected: PASS; E2E remains for CI.
