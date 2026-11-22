alter table app.votes
  add column is_public boolean not null default false;

alter table app.votes
  add constraint votes_public_general_only
  check (is_public = false or kind = 'general');
