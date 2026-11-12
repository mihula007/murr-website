-- Схема этапа 8: публикации, вложения и торговые объявления.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

select ok(
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'app'
      and tablename in ('publications', 'publication_attachments', 'market_listings')),
  'RLS включён у таблиц публикаций и рынка'
);

select ok(
  not exists (
    select 1
    from unnest(array['app.publications', 'app.publication_attachments',
        'app.market_listings']) as t(name),
      unnest(array['anon', 'authenticated']) as r(role)
    where has_table_privilege(r.role, t.name, 'select,insert,update,delete')
  ),
  'anon и authenticated не имеют прав на таблицы публикаций и рынка'
);

insert into auth.users (id, email, email_confirmed_at, aud, role)
values
  ('00000000-0000-0000-0000-000000000081', 'a8@example.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000082', 'b8@example.test', now(), 'authenticated', 'authenticated');

insert into app.profiles (id, display_name, game_nickname, class_id, access_role)
values
  ('00000000-0000-0000-0000-000000000081', 'А', 'Alpha8', 1, 'officer'),
  ('00000000-0000-0000-0000-000000000082', 'Б', 'Beta8', 1, 'member');

insert into app.publications (id, category, title, content, search_text, status, author_id, published_at)
values
  ('00000000-0000-0000-0000-0000000008a1', 'news', 'Опубликовано', '{"type":"doc"}', 'опубликовано',
    'published', '00000000-0000-0000-0000-000000000081', now()),
  ('00000000-0000-0000-0000-0000000008a2', 'guide', 'Черновик', '{"type":"doc"}', 'черновик',
    'draft', '00000000-0000-0000-0000-000000000081', null);

select throws_ok(
  $$insert into app.publications (category, title, content, search_text, status, author_id)
    values ('poem', 'Т', '{}', 'т', 'draft', '00000000-0000-0000-0000-000000000081')$$,
  '23514', null, 'неизвестная категория публикации отклоняется (PUB-02)'
);

select throws_ok(
  $$insert into app.publications (category, title, content, search_text, status, author_id)
    values ('news', '', '{}', '', 'draft', '00000000-0000-0000-0000-000000000081')$$,
  '23514', null, 'пустой заголовок отклоняется (PUB-03)'
);

select throws_ok(
  $$insert into app.publications (category, title, content, search_text, status, author_id)
    values ('news', 'Т', '"<p>html</p>"', 'т', 'draft', '00000000-0000-0000-0000-000000000081')$$,
  '23514', null, 'содержимое — только JSON-объект, не строка HTML (Q-57)'
);

select throws_ok(
  $$insert into app.publications (category, title, content, search_text, status, author_id)
    values ('news', 'Т', '{}', 'т', 'published', '00000000-0000-0000-0000-000000000081')$$,
  '23514', null, 'опубликованный материал имеет время публикации'
);

insert into app.publication_attachments (publication_id, path, file_name, size, content_type, position)
values ('00000000-0000-0000-0000-0000000008a1', 'uploads/x/a.png', 'a.png', 1000, 'image/png', 0);

select throws_ok(
  $$insert into app.publication_attachments (publication_id, path, file_name, size, content_type, position)
    values ('00000000-0000-0000-0000-0000000008a1', 'uploads/x/b.gif', 'b.gif', 1000, 'image/gif', 1)$$,
  '23514', null, 'вложение — только JPEG, PNG или WebP (Q-11)'
);

select throws_ok(
  $$insert into app.publication_attachments (publication_id, path, file_name, size, content_type, position)
    values ('00000000-0000-0000-0000-0000000008a1', 'uploads/x/c.png', 'c.png', 1048577, 'image/png', 1)$$,
  '23514', null, 'вложение больше 1 МБ отклоняется (Q-11)'
);

select throws_ok(
  $$insert into app.publication_attachments (publication_id, path, file_name, size, content_type, position)
    values ('00000000-0000-0000-0000-0000000008a1', 'uploads/x/d.png', 'd.png', 1, 'image/png', 10)$$,
  '23514', null, 'не больше 10 вложений на публикацию'
);

insert into app.market_listings (id, category, title, content, search_text, status, author_id, published_at)
values
  ('00000000-0000-0000-0000-0000000008b1', 'sale', 'Продам', '{"type":"doc"}', 'продам',
    'published', '00000000-0000-0000-0000-000000000082', now()),
  ('00000000-0000-0000-0000-0000000008b2', 'buy', 'Куплю', '{"type":"doc"}', 'куплю',
    'draft', '00000000-0000-0000-0000-000000000082', null);

select throws_ok(
  $$insert into app.market_listings (category, title, content, search_text, status, author_id)
    values ('auction', 'Т', '{}', 'т', 'draft', '00000000-0000-0000-0000-000000000082')$$,
  '23514', null, 'неизвестная категория объявления отклоняется (MKT-02)'
);

select throws_ok(
  $$delete from app.profiles where id = '00000000-0000-0000-0000-000000000081'$$,
  '23514', null, 'автора с черновиком нельзя удалить, пока черновик не удалён (PUB-17)'
);

delete from app.publications where id = '00000000-0000-0000-0000-0000000008a2';
delete from app.market_listings where id = '00000000-0000-0000-0000-0000000008b2';
delete from app.profiles
  where id in ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000082');

select is(
  (select author_id from app.publications where id = '00000000-0000-0000-0000-0000000008a1'),
  null,
  'опубликованный материал удалённого автора остаётся без связи (PUB-17)'
);

select is(
  (select author_id from app.market_listings where id = '00000000-0000-0000-0000-0000000008b1'),
  null,
  'опубликованное объявление удалённого автора остаётся без связи (MKT-12)'
);

delete from app.publications where id = '00000000-0000-0000-0000-0000000008a1';

select is(
  (select count(*)::int from app.publication_attachments where path = 'uploads/x/a.png'),
  0,
  'удаление публикации удаляет строки вложений (PUB-16)'
);

select ok(
  exists (select 1 from pg_indexes
    where schemaname = 'app' and indexname = 'publications_search'
      and indexdef like '%gin_trgm_ops%'),
  'поиск публикаций — триграммный индекс'
);

select * from finish();
rollback;
