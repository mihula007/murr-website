create table app.kh_queue_entries (
  id bigint generated always as identity primary key,
  queue_key text not null check (queue_key in (
    'summons',
    'kh_hands',
    'scale_buyout',
    'highest_buyout',
    'highest',
    'meteorites',
    'uf_passes',
    'essence',
    'scale',
    'dobi_stones',
    's_cards',
    'kh_passes',
    'disc',
    'pet'
  )),
  user_id uuid not null references app.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint kh_queue_entries_queue_key_user_id_key unique (queue_key, user_id)
);

create index kh_queue_entries_queue_key_id_idx
  on app.kh_queue_entries (queue_key, id);

alter table app.kh_queue_entries enable row level security;
revoke all on app.kh_queue_entries from public, anon, authenticated, service_role;
revoke all on sequence app.kh_queue_entries_id_seq
  from public, anon, authenticated, service_role;
