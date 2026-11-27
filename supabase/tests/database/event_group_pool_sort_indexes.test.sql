begin;
select plan(10);

select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_pa_asc_group_pool_sort' and indexdef like '%(pa, game_nickname, id)%'), 'ПА: сортировка по возрастанию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_pa_desc_group_pool_sort' and indexdef like '%pa DESC NULLS LAST%'), 'ПА: сортировка по убыванию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_pz_asc_group_pool_sort' and indexdef like '%(pz, game_nickname, id)%'), 'ПЗ: сортировка по возрастанию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_pz_desc_group_pool_sort' and indexdef like '%pz DESC NULLS LAST%'), 'ПЗ: сортировка по убыванию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_bu_asc_group_pool_sort' and indexdef like '%(bu, game_nickname, id)%'), 'БУ: сортировка по возрастанию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_bu_desc_group_pool_sort' and indexdef like '%bu DESC NULLS LAST%'), 'БУ: сортировка по убыванию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_hp_asc_group_pool_sort' and indexdef like '%(hp, game_nickname, id)%'), 'ХП: сортировка по возрастанию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_hp_desc_group_pool_sort' and indexdef like '%hp DESC NULLS LAST%'), 'ХП: сортировка по убыванию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_bd_asc_group_pool_sort' and indexdef like '%(bd, game_nickname, id)%'), 'БД: сортировка по возрастанию');
select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'profiles_bd_desc_group_pool_sort' and indexdef like '%bd DESC NULLS LAST%'), 'БД: сортировка по убыванию');

select * from finish();
rollback;
