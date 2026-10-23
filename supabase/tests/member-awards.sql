begin;
do $$ declare target uuid; champ uuid; begin
 select em.player_id into champ from public.matches m join public.entry_members em on em.entry_id=m.winner_entry_id
 join public.divisions d on d.id=m.division_id
 where d.tournament_id='17cda8a5-40d2-4b3e-b31e-7b8cd988d219' and m.stage='final' order by em.member_order limit 1;
 if champ is null then raise exception 'Missing champion fixture'; end if;
 select pa.user_id into target from public.player_accounts pa where pa.player_id=champ;
 if target is null then
  select p.id into target from public.member_profiles p join auth.users u on u.id=p.id where u.email_confirmed_at is not null order by p.created_at limit 1;
  insert into public.player_accounts(player_id,user_id,linked_by) select champ,target,a.user_id from public.fwt_admin_accounts a limit 1;
 end if;
 perform set_config('request.jwt.claim.sub',target::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated')::text,true);
 if has_function_privilege('anon','public.fwt_member_awards(uuid)','execute') then raise exception 'Anonymous grant';end if;
end $$;
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.fwt_member_awards(auth.uid()) a where a.tournament_id='17cda8a5-40d2-4b3e-b31e-7b8cd988d219' and a.award='champion' and jsonb_array_length(a.players)=2) then raise exception 'Past doubles championship not linked';end if;
 if exists(select 1 from public.fwt_member_awards('00000000-0000-0000-0000-000000000000')) then raise exception 'Unlinked member received awards';end if;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform public.fwt_member_awards(null);
  raise exception 'Unverified request accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
select 'PASS: historical linked doubles awards, no anonymous grant, no unverified access; all test links rolled back' as result;

