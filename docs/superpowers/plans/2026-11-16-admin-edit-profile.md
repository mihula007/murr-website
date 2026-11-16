# Правка ника и класса администратором — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Администратор меняет игровой ник и класс любого аккаунта из его карточки с проверкой, аудитом и обновлением текущих представлений.

**Architecture:** Добавить защищённую операцию `accounts/set-profile` в существующую Edge Function, которая в одной транзакции валидирует цель, профиль и ник и создаёт аудит. В карточке встроить форму с существующим `ClassSelect`, а после сохранения инвалидировать кеш аккаунтов, карточки, состава и аудита.

**Tech Stack:** TypeScript strict, React 19, TanStack Form, TanStack Query, zod, одна Supabase Edge Function, Postgres, Vitest, Playwright.

**Spec:** [2026-11-16-admin-edit-profile-design.md](../specs/2026-11-16-admin-edit-profile-design.md)

## Global Constraints

- Разработка только в `main`, без новых веток и рабочих копий.
- Клиент — React 19 + Vite; сервер — единственная Edge Function `api`; новых зависимостей, таблиц и миграций не добавлять.
- Любую запись вызывать через `useMutation`; сервер обязан проверять роль и ограничения.
- Формы используют TanStack Form, zod, `focusFirstInvalid`, `FormField`/`fieldError` и `useUnsavedChangesGuard`.
- Ник — до 9 символов и уникален с учётом регистра; класс обязателен и существует в справочнике.
- Аудит: категория `profiles`, только `changed_fields`, без прежних/новых значений; уведомления нет.
- Локально e2e не запускать; e2e проверит CI после принятия ручной проверки.

## Review Focus

- Ник, занятый другим аккаунтом, отклоняется без изменения цели; регистр учитывается, тот же ник разрешён.
- Класс вне справочника и пустые обязательные поля отклоняются с ошибкой поля.
- Невнутренняя роль, включая офицера, не может вызвать операцию напрямую.
- Аккаунт с начатым удалением нельзя изменить; собственный и другие администраторские аккаунты менять можно.
- Сохранение без отличий не пишет аудит; при изменении аудит содержит только реально изменённые поля и не создаёт уведомление.
- Отмена и закрытие грязной формы не сохраняют значения без подтверждения; узкий экран не получает горизонтальную прокрутку.
- Исторические снимки закрытых событий и посещений остаются прежними.

---

### Task 1: Защищённая операция правки профиля

**Files:**

- Modify: `supabase/functions/_shared/contracts/accounts.ts`
- Modify: `supabase/functions/_shared/accounts/service.ts`
- Modify: `supabase/functions/_shared/accounts/repository.ts`
- Modify: `supabase/functions/_shared/app.ts`
- Test: `tests/server/admin.test.ts`

**Interfaces:**

- Добавить `setProfileSchema`: `{ userId: guid, gameNickname: gameNicknameSchema, classId: classIdSchema }` и типы `SetProfileRequest` / `SetProfileResult`.
- Добавить `classId` в `AccountCard` и выбрать `p.class_id` в `accountRepository.card`, чтобы форма открывалась с сохранённым значением.
- Добавить `setAccountProfile(deps, actor, body)`, доступную только роли `admin`, результат `{ userId, gameNickname, classId }`.
- Зарегистрировать операцию `accounts/set-profile` в диспетчере `app.ts`.
- Сохранение в транзакции блокирует профиль цели, отклоняет отсутствующий или удаляемый аккаунт, проверяет класс через `catalogRepository.isActiveClass` и уникальность ника, обновляет только изменившиеся колонки и `updated_at`; аудит категории `profiles` имеет `changed_fields`, summary `Изменение профиля`, без значений.
- `accounts/get` возвращает `classId` вместе с существующей подписью класса; после сохранения клиент сбрасывает кеш карточки, аккаунтов, состава и карточек событий.
- Если нет изменений, вернуть текущие значения без обновления и аудита. Уникальное ограничение ника преобразовать в `validation_failed` с `fields.gameNickname = nickname_taken`.

- [x] **Шаг 1: Добавить серверные тесты, которые должны падать** в `tests/server/admin.test.ts`:
  - `allows admin to change nickname and class for any account` — изменить member и другого admin; результат и база содержат новые значения.
  - `allows admin to update own nickname and class` — обновить профиль исполнителя.
  - `rejects duplicate nickname and invalid class without changing profile` — ожидаются `nickname_taken` и ошибка класса; исходные поля сохраняются.
  - `rejects profile edits by non-admins` — applicant, reader, member, officer получают `forbidden`; guest/incomplete сохраняют свои коды доступа.
  - `does not update or audit unchanged values` — профиль неизменён, число соответствующих записей аудита не растёт.
  - `records only changed field names without values or notification` — одна запись `profiles/profile_updated`, `changed_fields` содержит только изменённые snake_case имена, в деталях нет значений; количество уведомлений не меняется.
  - `rejects edits while deletion is pending` — `state_conflict`, профиль не меняется.
- [x] **Шаг 2: Запустить эти тесты и убедиться, что они падают по отсутствующей операции.**

  Запуск: `npm run test:server -- tests/server/admin.test.ts`.

- [x] **Шаг 3: Реализовать схему, серверную операцию и регистрацию маршрута.** Использовать `requireRole(actor, ['admin'])`, `parseBody`, транзакцию, `profileRepository.findByIdForUpdate`, `profileRepository.nicknameTaken`, `catalogRepository.isActiveClass`, `userRepository.deletionPending`, `profileRepository.update`, обработчик конфликта `NICKNAME_CONSTRAINT` и `writeAudit`. `notify` не вызывать.
- [x] **Шаг 4: Повторить серверные тесты и убедиться, что они проходят.** `npm run test:server -- tests/server/admin.test.ts` прошёл: 16 тестов.

  Запуск: `npm run test:server -- tests/server/admin.test.ts`.

### Task 2: Форма редактирования в карточке

**Files:**

- Create: `src/features/admin/account-profile-fields.tsx`
- Modify: `src/features/admin/account-dialogs.tsx`
- Modify: `src/features/admin/api.ts`
- Test: `tests/admin-profile-edit.test.tsx`

**Interfaces:**

- `AccountProfileFields({ account }: { account: AccountCard })` показывает ник и класс в режиме чтения, действие «Изменить профиль» переключает на форму, «Отмена» сбрасывает ввод. Форма получает `classId` из ответа `accounts/get`.
- Использовать `ClassSelect` и `useSetAccountProfile()`; после успеха обновить содержимое карточки и закрыть форму.
- Мутация вызывает `accounts/set-profile`, инвалидирует карточку цели, список аккаунтов, списки состава, карточки событий и аудит; если цель — текущий администратор, перечитывает его `account/me`.
- Форма сохраняет оба значения одновременно, активирует «Сохранить» только при изменениях, показывает ошибки у полей и глобальную ошибку через `formErrorMessage`, блокирует поля при сохранении и подключает предупреждение о несохранённом вводе.

- [x] **Шаг 1: Добавить компонентные тесты, которые должны падать** в `tests/admin-profile-edit.test.tsx`:
  - карточка в режиме чтения показывает ник и класс, кнопка раскрывает редактирование;
  - выбор ника и класса и нажатие «Сохранить» вызывает `accounts/set-profile` ровно один раз с `userId`, `gameNickname`, `classId`;
  - «Отмена» возвращает исходный вид без вызова операции;
  - серверная ошибка `nickname_taken` показана у поля ника и не закрывает форму;
  - без изменений кнопка сохранения выключена;
  - несохранённый ввод показывает предупреждение при попытке закрыть карточку.
  - режим admin показывает управление в карточке выбранного аккаунта; серверные тесты отдельно проверяют, что цель может быть собственным или другим аккаунтом администратора.
- [x] **Шаг 2: Запустить новый компонентный тест и убедиться, что он падает из-за отсутствующей формы.**

  Запуск: `npx vitest run tests/admin-profile-edit.test.tsx`.

- [x] **Шаг 3: Добавить форму, встроить её в карточку и связать с мутацией и кешами.** Существующие поля ник/класс показывать в одном месте карточки, не дублировать их.
- [x] **Шаг 4: Повторить тест и убедиться, что он проходит.** `npx vitest run tests/admin-profile-edit.test.tsx tests/admin-character-stats.test.tsx` прошёл: 12 тестов.

  Запуск: `npx vitest run tests/admin-profile-edit.test.tsx`.

### Task 3: Сквозная проверка карточки и аудит

**Files:**

- Modify: `e2e/admin.spec.ts`

**Interfaces:**

- Продолжить существующий сценарий `ADM: поиск, карточка, журнал и безвозвратное удаление`.
- До закрытия карточки изменить target ник и класс через форму; подтвердить, что актуальная карточка показывает оба значения.
- Убедиться прямым запросом, что audit содержит одно действие категории `profiles` и только названия изменённых полей; после закрытия карточки проверить новое имя в таблице/поиске.
- Удалить тестовый аккаунт после изменения, подтвердив удаление уже новым ником.
- Проверить ширину 375 px без горизонтальной прокрутки.

- [x] **Шаг 1: Дополнить Playwright сценарий и запустить только быстрые проверки `npm run check:quick`; e2e не запускать локально.** E2E добавлен в CI-путь и локально не запускается.

### Итоговые проверки

- `npm run check:quick` — пройдено: 19 файлов, 213 тестов.
- `npm run test:server` — пройдено: 23 файла, 338 тестов.
- `npm run supabase:test` не нужен: схема базы не меняется.
- Локальный e2e не запускать; весь Playwright набор запускает CI при выкладке.

### Раздельные сохранения по процессу сопровождающего

- Требования и решение сопровождающего: `docs(requirements): описать правку ника и класса администратором`.
- Этот план и дизайн: отдельное сохранение до реализации.
- Реализация: один Conventional Commit в `main`; push будет только после ручной проверки и явного принятия.
