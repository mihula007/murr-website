create extension if not exists pg_trgm with schema extensions;

create index profiles_game_nickname_trgm
  on app.profiles using gin (game_nickname extensions.gin_trgm_ops);
