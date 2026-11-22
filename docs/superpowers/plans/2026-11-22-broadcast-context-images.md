# Картинки рассылок из голосований и групп — план реализации

> **Для исполнителей:** использовать `superpowers:executing-plans` и выполнять задачи по порядку. Шаги отмечать флажками.

**Цель:** При отправке рассылки из активного голосования или группы прикладывать соответствующую картинку во все выбранные мессенджеры.

**Устройство:** Два изображения хранятся среди публичных картинок сайта. Сервер выбирает их по проверенному источнику: активному `voteId` или уже передаваемому `groupId`; существующие адаптеры Telegram, MAX и ВКонтакте отправляют изображения. В Telegram длинный текст идёт отдельным сообщением вслед за картинкой.

**Технологии:** TypeScript, React, одна Supabase Edge Function, существующие Bot API-адаптеры, Vitest и Playwright.

**Замысел:** `docs/superpowers/specs/2026-11-22-broadcast-context-images-design.md`.

## Общие ограничения

- Не добавлять таблицы, миграции, зависимости, поля для загрузки файлов или секреты.
- Использовать точные файлы сопровождающего: `голосование.jpg` и `список групп.jpg`; публичные имена в проекте — `vote.jpg` и `group-list.jpg`.
- Картинки отправлять только для рассылок, открытых из активного голосования или группы; общая форма и шаблоны остаются без картинок.
- Не менять роли, получателей, подтверждение, подсчёт доставки, уведомления и смысл аудита.
- При сбое отправки картинки отправлять полный текст без картинки.
- Текст рассылки остаётся ограничен 3800 символами. Для Telegram при тексте длиннее лимита подписи отправлять картинку, затем полный текст отдельным сообщением.
- Работать на `main`, без веток и дополнительных рабочих папок.

## Область независимой проверки

- Неизвестный, закрытый или изменившийся до отправки источник не должен вызвать отправку.
- Запрос не может прислать `voteId` вместе с событием или группой.
- Длинный текст Telegram должен дойти полностью, даже если картинка не отправилась.
- Ошибка загрузки картинки MAX или ВКонтакте должна оставить текстовую отправку.
- Обычная форма не должна получить картинку по подделанному тексту или отсутствующему источнику.

---

### Задача 1: Статические картинки и сопоставление с источником

**Файлы:**
- Создать: `public/messenger/vote.jpg`
- Создать: `public/messenger/group-list.jpg`
- Создать: `supabase/functions/_shared/messenger/broadcast-image.ts`
- Изменить и проверить: `tests/server/messenger-event-images.test.ts`

**Интерфейсы:**
- Создаёт `broadcastImageUrl(siteUrl: string | null, source: 'vote' | 'group'): string | null`.
- URL — `<SITE_URL>/messenger/vote.jpg` для `vote`, `<SITE_URL>/messenger/group-list.jpg` для `group`; при пустом `siteUrl` — `null`.

- [ ] **Шаг 1: Написать падающий тест URL-сопоставления.** Проверить оба файла, ведущий слэш в `siteUrl` и `null`.
- [ ] **Шаг 2: Запустить только новый тест и убедиться, что он падает из-за отсутствующей функции.**

Run: `npm run test:server -- tests/server/messenger-event-images.test.ts -t broadcastImageUrl`
Expected: FAIL, `broadcastImageUrl` отсутствует.

- [ ] **Шаг 3: Добавить функцию сопоставления и две предоставленные картинки.** Копировать исходники из `C:\Users\info\Desktop\голосование.jpg` и `C:\Users\info\Desktop\список групп.jpg` в указанные публичные пути.
- [ ] **Шаг 4: Запустить тест сопоставления.**

Run: `npm run test:server -- tests/server/messenger-event-images.test.ts -t broadcastImageUrl`
Expected: PASS для обоих URL и отсутствующего `siteUrl`.

- [ ] **Шаг 5: Сохранить задачу Conventional Commit.**

```bash
git add public/messenger/vote.jpg public/messenger/group-list.jpg supabase/functions/_shared/messenger/broadcast-image.ts tests/server/messenger-event-images.test.ts
git commit -m "feat(broadcast): add vote and group images"
```

### Задача 2: Проверенный источник и изображения в трёх каналах

**Файлы:**
- Изменить: `supabase/functions/_shared/contracts/broadcasts.ts`
- Изменить: `supabase/functions/_shared/broadcasts/service.ts`
- Изменить: `src/features/broadcast/broadcast-page.tsx`
- Изменить: `supabase/functions/_shared/telegram/announcements.ts`
- Изменить: `supabase/functions/_shared/max/announcements.ts`
- Изменить: `supabase/functions/_shared/vk/announcements.ts`
- Проверить/изменить: `tests/server/messenger-event-images.test.ts`
- Проверить/изменить: `tests/broadcast.test.tsx`

**Интерфейсы:**
- `sendAnnouncementSchema` принимает необязательный `voteId`; вместе с `eventId` или `groupId` он запрещён.
- `BroadcastForm` передаёт `voteId` из текущего источника голосования при отправке.
- `sendAnnouncement` проверяет, что голосование существует и открыто; картинка голосования или группы определяется только сервером. Текущий `groupId` остаётся единственным источником получателей группы.
- `deliverAnnouncement`, `deliverMaxAnnouncement`, `deliverVkAnnouncement` получают уже проверенный `imageUrl`; доставка MAX/ВКонтакте использует текущую схему однократной загрузки на канал.

- [ ] **Шаг 1: Добавить интеграционные тесты для рассылок из активного голосования и группы во все три канала, общей формы без картинки, сбоя загрузки MAX/ВКонтакте и неизменного состава получателей группы.** Проверить правильный URL каждой картинки.
- [ ] **Шаг 2: Запустить новый тест и увидеть, что сейчас у этих сообщений нет картинки.**

Run: `npm run test:server -- tests/server/messenger-event-images.test.ts -t "vote and group broadcasts"`
Expected: FAIL, картинки для новых источников ещё не передаются.

- [ ] **Шаг 3: Добавить `voteId`, серверную проверку активного голосования и передачу проверенного URL всем трём каналам.** Добавить проверку, что закрытый/неизвестный `voteId` и конфликтующие источники завершаются до любой отправки.
- [ ] **Шаг 4: Добавить компонентную проверку, что форма, открытая из голосования, передаёт его ID в `broadcasts/send`; обычная форма его не передаёт.**
- [ ] **Шаг 5: Запустить тесты серверного отправления и формы рассылки.**

Run: `npm run test:server -- tests/server/messenger-event-images.test.ts` и `npm test -- tests/broadcast.test.tsx`
Expected: PASS; существующие картинки событий и обычная рассылка сохраняют прежнее поведение.

- [ ] **Шаг 6: Сохранить задачу Conventional Commit.**

```bash
git add supabase/functions/_shared/contracts/broadcasts.ts supabase/functions/_shared/broadcasts/service.ts src/features/broadcast/broadcast-page.tsx supabase/functions/_shared/telegram/announcements.ts supabase/functions/_shared/max/announcements.ts supabase/functions/_shared/vk/announcements.ts tests/server/messenger-event-images.test.ts tests/broadcast.test.tsx
git commit -m "feat(broadcast): send source images across messengers"
```

### Задача 3: Длинный текст Telegram, сквозная проверка и статус

**Файлы:**
- Изменить: `supabase/functions/_shared/telegram/announcements.ts`
- Изменить: `tests/server/messenger-event-images.test.ts`
- Изменить: `e2e/broadcast.spec.ts`
- Обновить статусы: `docs/requirements/14-broadcast.md`, `docs/requirements/19-telegram.md`, `docs/requirements/20-max.md`, `docs/requirements/21-vk.md`

**Интерфейсы:**
- Если изображение выбрано и текст превышает `BROADCAST_LIMITS.imageBody` (880 символов), Telegram отправляет пустую картинку, затем исходный полный текст сообщением без изображения.
- Если отправка картинки не удалась, Telegram отправляет только полный текст одним сообщением. Успех считается по доставке полного текста; частичная доставка отмечается как неудачная.

- [ ] **Шаг 1: Написать тесты короткого текста с картинкой в подписи, длинного текста с отдельным сообщением, и сбоя картинки с сохранением полного текста.**
- [ ] **Шаг 2: Запустить эти тесты и убедиться, что длинная рассылка ещё не отправляет полный текст отдельным сообщением.**

Run: `npm run test:server -- tests/server/messenger-event-images.test.ts -t "long Telegram broadcast"`
Expected: FAIL на порядке и составе вызовов Telegram.

- [ ] **Шаг 3: Изменить отправку Telegram для лимита подписи 880; не менять обычный лимит 3800 и доставку MAX/ВКонтакте.**
- [ ] **Шаг 4: Запустить полный серверный тест изображений, компонентный тест формы и быстрые проверки.**

Run: `npm run test:server -- tests/server/messenger-event-images.test.ts`, `npm test -- tests/broadcast.test.tsx`, затем `npm run check:quick`
Expected: PASS.

- [ ] **Шаг 5: Добавить e2e-проверку, что подтверждённая отправка из активного голосования передаёт `voteId`, а подготовка из группы сохраняет её `groupId`. E2e только написать; локально не запускать, его прогонит CI после принятия и выкладки.**
- [ ] **Шаг 6: Отметить BRC-18, TGM-29, MAX-14 и VK-11 как реализованные, повторно проверить подготовленные изменения и сканер секретов.**
- [ ] **Шаг 7: Сохранить оставшееся Conventional Commit.**

```bash
git add supabase/functions/_shared/telegram/announcements.ts tests/server/messenger-event-images.test.ts e2e/broadcast.spec.ts docs/requirements/14-broadcast.md docs/requirements/19-telegram.md docs/requirements/20-max.md docs/requirements/21-vk.md
git commit -m "feat(broadcast): preserve long Telegram image announcements"
```

## Самопроверка плана

- Каждое правило замысла покрыто задачами: сопоставление файлов — задача 1; проверенный контекст и три канала — задача 2; предел Telegram и сбой — задача 3; e2e — задача 3.
- Проверки не меняют схему, поэтому миграции, pgTAP и локальные тестовые данные не нужны.
- Аудит и клиентские ошибки остаются в текущем пути `broadcasts/send`; получатели и права не трогаются.
- E2e добавляется, но запускается только CI на шаге 6 выкладки по правилам проекта.
