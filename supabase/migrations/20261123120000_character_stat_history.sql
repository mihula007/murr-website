-- История характеристик начинается на текущих значениях при выкладке;
-- более ранние записи журнала аудита в историю не преобразуются.
create table app.character_stat_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles (id) on delete cascade,
  field text not null check (field in ('pa', 'pz', 'bu', 'hp', 'bd')),
  value numeric(18, 3),
  recorded_at timestamptz not null default now(),
  kind text not null default 'change' check (kind in ('baseline', 'change'))
);

create index character_stat_history_user_field_recorded
  on app.character_stat_history (user_id, field, recorded_at desc, id desc);

alter table app.character_stat_history enable row level security;
revoke all on app.character_stat_history from public, anon, authenticated, service_role;

insert into app.character_stat_history (user_id, field, value, recorded_at, kind)
select p.id, s.field, s.value, now(), 'baseline'
from app.profiles as p
cross join lateral (values
  ('pa', p.pa),
  ('pz', p.pz),
  ('bu', p.bu),
  ('hp', p.hp),
  ('bd', p.bd)
) as s(field, value);
