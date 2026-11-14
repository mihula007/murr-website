-- Характеристики персонажа для администратора и рейтинга состава.
-- Поля nullable и без default, поэтому существующие профили остаются пустыми.

alter table app.profiles
  add column pa numeric(18, 3),
  add column pz numeric(18, 3),
  add column bu numeric(18, 3),
  add column hp numeric(18, 3),
  add column bd numeric(18, 3),
  add column character_stats_source text,
  add constraint profiles_pa_nonnegative check (pa is null or pa >= 0),
  add constraint profiles_pz_nonnegative check (pz is null or pz >= 0),
  add constraint profiles_bu_nonnegative check (bu is null or bu >= 0),
  add constraint profiles_hp_nonnegative check (hp is null or hp >= 0),
  add constraint profiles_bd_nonnegative check (bd is null or bd >= 0),
  add constraint profiles_character_stats_source_length
    check (character_stats_source is null or char_length(character_stats_source) <= 160);
