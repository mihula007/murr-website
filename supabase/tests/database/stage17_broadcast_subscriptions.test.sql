begin;

select plan(1);

select has_index(
  'app',
  'profiles',
  'profiles_game_nickname_trgm',
  'server-side substring search has a trigram index'
);

select * from finish();

rollback;
