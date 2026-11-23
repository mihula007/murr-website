-- Пятничные снимки характеристик (DYN-05) дополняют исходные значения и
-- ручные изменения, но остаются отдельным видом записи.
alter table app.character_stat_history
  drop constraint character_stat_history_kind_check;

alter table app.character_stat_history
  add constraint character_stat_history_kind_check
  check (kind in ('baseline', 'change', 'checkpoint'));

create unique index character_stat_history_checkpoint_unique
  on app.character_stat_history (user_id, field, recorded_at)
  where kind = 'checkpoint';

-- Пятница 20:59 UTC — 23:59 по Москве. Используются те же Vault-секреты,
-- что и у существующего расписания постоянных событий.
select cron.schedule(
  'roster-dynamics-checkpoint-weekly',
  '59 20 * * 5',
  $job$
  select net.http_post(
    url := s.api_url || '/functions/v1/api/roster/dynamics/checkpoint-weekly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', s.secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from (
    select
      (select decrypted_secret from vault.decrypted_secrets
        where name = 'events_cron_api_url') as api_url,
      (select decrypted_secret from vault.decrypted_secrets
        where name = 'events_cron_secret') as secret
  ) as s
  where s.api_url is not null and s.secret is not null
  $job$
);
