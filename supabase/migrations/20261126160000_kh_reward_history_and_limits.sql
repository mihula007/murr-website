alter table app.kh_queue_entries
  alter column user_id drop not null;

alter table app.kh_queue_entries
  add column game_nickname text,
  add column auto_rejoin boolean not null default false;

update app.kh_queue_entries e
set game_nickname = p.game_nickname
from app.profiles p
where p.id = e.user_id;

alter table app.kh_queue_entries
  alter column game_nickname set not null;

alter table app.kh_queue_entries
  drop constraint kh_queue_entries_queue_key_user_id_key;

create unique index kh_queue_entries_queue_user_uidx
  on app.kh_queue_entries (queue_key, user_id)
  where user_id is not null;

create unique index kh_queue_entries_queue_nickname_uidx
  on app.kh_queue_entries (queue_key, lower(game_nickname))
  where user_id is null;

create table app.kh_queue_settings (
  id boolean primary key default true check (id),
  max_active_queues smallint not null default 14
    check (max_active_queues between 1 and 14),
  updated_at timestamptz not null default now()
);

insert into app.kh_queue_settings (id) values (true);

create table app.kh_queue_rejoin_waitlist (
  id bigint generated always as identity primary key,
  queue_key text not null check (queue_key in (
    'summons', 'kh_hands', 'scale_buyout', 'highest_buyout', 'highest',
    'meteorites', 'uf_passes', 'essence', 'scale', 'dobi_stones', 's_cards',
    'kh_passes', 'disc', 'pet'
  )),
  user_id uuid not null references app.profiles (id) on delete cascade,
  game_nickname text not null,
  requested_at timestamptz not null default now(),
  constraint kh_queue_rejoin_waitlist_queue_user_key unique (queue_key, user_id)
);

create index kh_queue_rejoin_waitlist_user_requested_idx
  on app.kh_queue_rejoin_waitlist (user_id, requested_at, id);

create table app.kh_reward_history (
  id bigint generated always as identity primary key,
  queue_key text not null check (queue_key in (
    'summons', 'kh_hands', 'scale_buyout', 'highest_buyout', 'highest',
    'meteorites', 'uf_passes', 'essence', 'scale', 'dobi_stones', 's_cards',
    'kh_passes', 'disc', 'pet'
  )),
  user_id uuid references app.profiles (id) on delete set null,
  game_nickname text not null,
  issued_by uuid references app.profiles (id) on delete set null,
  issued_at timestamptz not null default now()
);

create index kh_reward_history_issued_at_id_idx
  on app.kh_reward_history (issued_at desc, id desc);

alter table app.kh_queue_settings enable row level security;
alter table app.kh_queue_rejoin_waitlist enable row level security;
alter table app.kh_reward_history enable row level security;

revoke all on app.kh_queue_entries, app.kh_queue_settings,
  app.kh_queue_rejoin_waitlist, app.kh_reward_history
  from public, anon, authenticated, service_role;
revoke all on sequence app.kh_queue_rejoin_waitlist_id_seq,
  app.kh_reward_history_id_seq from public, anon, authenticated, service_role;

-- Ники и порядок колонок из таблицы сопровождающего. Явные варианты нужны
-- только для зарегистрированных имён с отличающимися символами/регистром.
delete from app.kh_queue_entries;

with imported(queue_key, game_nickname, account_nicknames) as (
  values
    ('summons', '~KiCa~', array['~KiCa~']::text[]),
    ('summons', 'Бафка!', array['Бафка!']::text[]),
    ('summons', '~EKstazi~', array['~EKstazi~']::text[]),
    ('summons', 'отБога', array['oтБога']::text[]),
    ('summons', 'МойЁжик', array['МойЕжик']::text[]),
    ('summons', 'АсакураЙо', array['АсакураЙo']::text[]),

    ('kh_hands', 'Healicava', array['Healicavа']::text[]),
    ('kh_hands', 'RMKYN', array['RMKYN']::text[]),
    ('kh_hands', 'отбога', array['oтБога']::text[]),
    ('kh_hands', 'мойежик', array['МойЕжик']::text[]),
    ('kh_hands', 'О,Белка!', array['О,Бeлкa!']::text[]),
    ('kh_hands', 'C a r r i o n', array['Ｃａｒｒｉｏｎ']::text[]),
    ('kh_hands', 'p@м3e(', array['р@м3е(']::text[]),
    ('kh_hands', 'МякишШШ', array['МякишшШ']::text[]),

    ('scale_buyout', 'Ypokoitel', array['Ypоkoitel']::text[]),
    ('scale_buyout', 'МойЁжик', array['МойЕжик']::text[]),
    ('scale_buyout', 'ScepticX', array['ScepticX']::text[]),

    ('highest_buyout', 'МякишШШ', array['МякишшШ']::text[]),
    ('highest_buyout', 'KotKokos', array['KotКоkоs']::text[]),

    ('highest', 'XromM', array['ХromМ']::text[]),
    ('highest', 'RMKYN', array['RMKYN']::text[]),
    ('highest', 'мисси', array[]::text[]),
    ('highest', 'сет', array[]::text[]),

    ('meteorites', 'Erbe', array['Erbe']::text[]),
    ('meteorites', 'rud`alive', array[]::text[]),
    ('meteorites', 'RMKYN', array['RMKYN']::text[]),
    ('meteorites', 'fulmen', array['fulmеn']::text[]),
    ('meteorites', 'sprngvoid', array['sprngvoid']::text[]),
    ('meteorites', 'мисси', array[]::text[]),
    ('meteorites', 'чечня', array[]::text[]),
    ('meteorites', 'JINX', array['JINХ']::text[]),
    ('meteorites', 'LoO', array['LoO']::text[]),
    ('meteorites', 'SmIlLe', array[]::text[]),
    ('meteorites', 'P@ndor@', array['P@ndor@']::text[]),
    ('meteorites', 'Креста', array['Крeста']::text[]),
    ('meteorites', 'МякишШШ', array['МякишшШ']::text[]),
    ('meteorites', 'Let''splay', array[]::text[]),

    ('uf_passes', 'Ypokoitel', array['Ypоkoitel']::text[]),
    ('uf_passes', 'Fox9', array[]::text[]),
    ('uf_passes', '~EKstazi~', array['~EKstazi~']::text[]),
    ('uf_passes', 'отБога', array['oтБога']::text[]),
    ('uf_passes', 'мойежик', array['МойЕжик']::text[]),
    ('uf_passes', 'чечня', array[]::text[]),
    ('uf_passes', 'Котина', array['Котина']::text[]),
    ('uf_passes', 'JINX', array['JINХ']::text[]),
    ('uf_passes', 'Мускат', array['Mускат']::text[]),
    ('uf_passes', 'KotKokos', array['KotКоkоs']::text[]),
    ('uf_passes', 'Сучамба', array['Сучамба']::text[]),
    ('uf_passes', '~KiCa~', array['~KiCa~']::text[]),
    ('uf_passes', 'МякишШШ', array['МякишшШ']::text[]),
    ('uf_passes', 'Let''splay', array[]::text[]),
    ('uf_passes', 'XromM', array['ХromМ']::text[]),
    ('uf_passes', 'RMKYN', array['RMKYN']::text[]),

    ('essence', 'RMKYN', array['RMKYN']::text[]),
    ('essence', 'Бафка', array['Бафка!']::text[]),
    ('essence', 'KotKokos', array['KotКоkоs']::text[]),
    ('essence', 'Сучамба', array['Сучамба']::text[]),
    ('essence', '~KiCa~', array['~KiCa~']::text[]),
    ('essence', 'МякишШШ', array['МякишшШ']::text[]),

    ('scale', 'RMKYN', array['RMKYN']::text[]),
    ('scale', 'мисси', array[]::text[]),
    ('scale', 'чечня', array[]::text[]),
    ('scale', 'мойежик', array['МойЕжик']::text[]),

    ('dobi_stones', 'упокоитель', array['Ypоkoitel']::text[]),
    ('dobi_stones', 'чечня\\сет', array[]::text[]),
    ('dobi_stones', 'Креста', array['Крeста']::text[]),
    ('dobi_stones', 'fury', array['fury']::text[]),
    ('dobi_stones', 'sprngvoid', array['sprngvoid']::text[]),
    ('dobi_stones', 'мисси', array[]::text[]),
    ('dobi_stones', 'О,Белка!', array['О,Бeлкa!']::text[]),
    ('dobi_stones', 'Let''splay', array[]::text[]),
    ('dobi_stones', 'RMKYN', array['RMKYN']::text[]),

    ('s_cards', 'мойежик', array['МойЕжик']::text[]),
    ('s_cards', 'бафка', array['Бафка!']::text[]),
    ('s_cards', 'JINX', array['JINХ']::text[]),
    ('s_cards', '~KiCa~', array['~KiCa~']::text[]),
    ('s_cards', 'АсакураЙо', array['АсакураЙo']::text[]),
    ('s_cards', 'Let''splay', array[]::text[]),
    ('s_cards', 'МякишШШ', array['МякишшШ']::text[]),
    ('s_cards', 'RMKYN', array['RMKYN']::text[]),

    ('kh_passes', 'Мускат', array['Mускат']::text[]),
    ('kh_passes', 'RMKYN', array['RMKYN']::text[]),
    ('kh_passes', 'Miracle', array[]::text[]),

    ('disc', 'batasay', array[]::text[]),
    ('pet', 'P@ndor@', array['P@ndor@']::text[])
)
insert into app.kh_queue_entries (queue_key, user_id, game_nickname)
select
  imported.queue_key,
  matched.id,
  coalesce(matched.game_nickname, imported.game_nickname)
from imported
left join lateral (
  select p.id, p.game_nickname
  from app.profiles p
  where p.game_nickname = any(imported.account_nicknames)
  order by p.id
  limit 1
) matched on true;
