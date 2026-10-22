begin;
-- Exact dates are excluded from member-directory SELECT privileges.
alter table public.member_profiles add column birth_date date
  check(birth_date >= date '1900-01-01' and birth_date <= current_date);
revoke select on public.member_profiles from authenticated;
grant select(id,nickname,age_band,tennis_since,directory_consent,created_at)
  on public.member_profiles to authenticated;
-- Force profile writes through one validated, atomic operation.
revoke insert(id,nickname,age_band,tennis_since,directory_consent),
  update(nickname,age_band,tennis_since,directory_consent)
  on public.member_profiles from authenticated;

create function public.fwt_member_profile(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path=''
as $$ declare target_user uuid:=coalesce(p_user,auth.uid()); result jsonb; begin
  if not public.is_fwt_verified_member() then
    raise exception using errcode='42501',message='FWT_MEMBER_REQUIRED';
  end if;
  if target_user<>auth.uid() and not public.is_fwt_admin() then
    raise exception using errcode='42501',message='FWT_PRIVATE_PROFILE';
  end if;
  select jsonb_build_object('id',id,'nickname',nickname,'birth_date',birth_date,'tennis_since',tennis_since)
  into result from public.member_profiles where id=target_user;
  return result;
end $$;
revoke all on function public.fwt_member_profile(uuid) from public,anon;
grant execute on function public.fwt_member_profile(uuid) to authenticated;

create function public.fwt_save_member_profile(
 p_nickname text,p_birth_date date,p_tennis_since date,p_directory_consent boolean
) returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not public.is_fwt_verified_member() then
    raise exception using errcode='42501',message='FWT_MEMBER_REQUIRED';
  end if;
  if p_birth_date is null or p_birth_date<date '1900-01-01' or p_birth_date>current_date then
    raise exception 'FWT_INVALID_BIRTH_DATE';
  end if;
  if p_nickname is null or char_length(btrim(p_nickname)) not between 2 and 24 then
    raise exception 'FWT_INVALID_NICKNAME';
  end if;
  if p_tennis_since is null or p_tennis_since<date '1900-01-01' or p_tennis_since>current_date or extract(day from p_tennis_since)<>1 then
    raise exception 'FWT_INVALID_TENNIS_SINCE';
  end if;
  if p_directory_consent is distinct from true then raise exception 'FWT_CONSENT_REQUIRED'; end if;
  insert into public.member_profiles(id,nickname,birth_date,age_band,tennis_since,directory_consent)
    values(auth.uid(),btrim(p_nickname),p_birth_date,'private',p_tennis_since,true)
  on conflict(id) do update set nickname=excluded.nickname,birth_date=excluded.birth_date,
    tennis_since=excluded.tennis_since,directory_consent=true;
  return public.fwt_member_profile();
end $$;
revoke all on function public.fwt_save_member_profile(text,date,date,boolean) from public,anon;
grant execute on function public.fwt_save_member_profile(text,date,date,boolean) to authenticated;
commit;
