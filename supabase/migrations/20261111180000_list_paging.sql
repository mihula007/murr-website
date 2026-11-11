-- Keyset-пагинация решённых заявок: порядок (decided_at desc, id desc).
-- Списки по нику используют уникальный индекс profiles.game_nickname.
create index join_applications_decided
  on app.join_applications (decided_at desc, id desc)
  where decided_at is not null;
