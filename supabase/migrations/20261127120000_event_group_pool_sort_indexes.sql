create index profiles_pa_asc_group_pool_sort
  on app.profiles (pa asc nulls last, game_nickname asc, id asc);
create index profiles_pa_desc_group_pool_sort
  on app.profiles (pa desc nulls last, game_nickname asc, id asc);
create index profiles_pz_asc_group_pool_sort
  on app.profiles (pz asc nulls last, game_nickname asc, id asc);
create index profiles_pz_desc_group_pool_sort
  on app.profiles (pz desc nulls last, game_nickname asc, id asc);
create index profiles_bu_asc_group_pool_sort
  on app.profiles (bu asc nulls last, game_nickname asc, id asc);
create index profiles_bu_desc_group_pool_sort
  on app.profiles (bu desc nulls last, game_nickname asc, id asc);
create index profiles_hp_asc_group_pool_sort
  on app.profiles (hp asc nulls last, game_nickname asc, id asc);
create index profiles_hp_desc_group_pool_sort
  on app.profiles (hp desc nulls last, game_nickname asc, id asc);
create index profiles_bd_asc_group_pool_sort
  on app.profiles (bd asc nulls last, game_nickname asc, id asc);
create index profiles_bd_desc_group_pool_sort
  on app.profiles (bd desc nulls last, game_nickname asc, id asc);
