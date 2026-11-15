alter table app.profiles
  drop constraint profiles_display_name_check,
  add constraint profiles_display_name_check
    check (char_length(display_name) between 0 and 12);
