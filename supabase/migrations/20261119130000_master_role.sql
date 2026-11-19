alter table app.profiles
  drop constraint profiles_access_role_check;

alter table app.profiles
  add constraint profiles_access_role_check
  check (access_role in ('applicant', 'reader', 'member', 'officer', 'master', 'admin'));
