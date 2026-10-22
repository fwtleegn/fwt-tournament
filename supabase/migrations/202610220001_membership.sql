-- Review in a staging database first. This transaction never modifies tournament rows.
begin;
create table public.fwt_admin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.fwt_admin_accounts enable row level security;
revoke all on public.fwt_admin_accounts from anon, authenticated;
-- Preserve only the existing configured administrator; abort if not verified/present.
insert into public.fwt_admin_accounts(user_id)
select id from auth.users where lower(email) = 'scooler.arg1@gmail.com' and email_confirmed_at is not null;
do $$ begin
  if not exists(select 1 from public.fwt_admin_accounts) then
    raise exception 'Verified existing administrator not found; transaction cancelled';
  end if;
end $$;
create function public.is_fwt_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.fwt_admin_accounts where user_id = auth.uid()); $$;
revoke all on function public.is_fwt_admin() from public, anon;
grant execute on function public.is_fwt_admin() to authenticated;
-- Restrictive policies also constrain existing permissive USING(true) policies.
do $$ declare t text; begin
  foreach t in array array['tournaments','divisions','courts','players','entries','entry_members','groups','group_entries','matches'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from anon',t);
    execute format('revoke truncate,references,trigger on public.%I from authenticated',t);
    execute format('create policy fwt_members_read on public.%I for select to authenticated using (true)',t);
    execute format('create policy fwt_admin_insert_guard on public.%I as restrictive for insert to authenticated with check (public.is_fwt_admin())',t);
    execute format('create policy fwt_admin_update_guard on public.%I as restrictive for update to authenticated using (public.is_fwt_admin()) with check (public.is_fwt_admin())',t);
    execute format('create policy fwt_admin_delete_guard on public.%I as restrictive for delete to authenticated using (public.is_fwt_admin())',t);
  end loop;
end $$;
create table public.member_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check(char_length(btrim(nickname)) between 2 and 24),
  age_band text not null check(age_band in ('under20','20s','30s','40s','50s','60plus','private')),
  tennis_since date not null check(tennis_since >= date '1900-01-01' and tennis_since <= current_date and extract(day from tennis_since) = 1),
  directory_consent boolean not null default false check(directory_consent),
  created_at timestamptz not null default now()
);
create unique index member_profiles_nickname_unique on public.member_profiles(lower(btrim(nickname)));
create function public.is_fwt_verified_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null and is_anonymous = false); $$;
revoke all on function public.is_fwt_verified_member() from public, anon;
grant execute on function public.is_fwt_verified_member() to authenticated;
alter table public.member_profiles enable row level security;
revoke all on public.member_profiles from anon, authenticated;
grant select on public.member_profiles to authenticated;
grant insert(id,nickname,age_band,tennis_since,directory_consent), update(nickname,age_band,tennis_since,directory_consent) on public.member_profiles to authenticated;
create policy member_directory_read on public.member_profiles for select to authenticated
using ((select public.is_fwt_verified_member()));
create policy member_profile_create on public.member_profiles for insert to authenticated
with check(id = (select auth.uid()) and (select public.is_fwt_verified_member()));
create policy member_profile_edit on public.member_profiles for update to authenticated
using(id = (select auth.uid()) and (select public.is_fwt_verified_member()))
with check(id = (select auth.uid()) and (select public.is_fwt_verified_member()));
commit;
