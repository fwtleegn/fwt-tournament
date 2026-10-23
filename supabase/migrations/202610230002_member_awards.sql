begin;
-- Derive history from official results and administrator-approved player links.
-- No copied award records: links, corrected scores and old tournaments stay in sync.
create or replace function public.fwt_member_awards(p_member uuid)
returns table(tournament_id uuid, division_id uuid, tournament_name text,
 tournament_date date, division_name text, award text, entry_id uuid, players jsonb)
language plpgsql stable security definer set search_path=''
as $$ begin
 if not public.is_fwt_verified_member() then
  raise exception using errcode='42501',message='FWT_MEMBER_REQUIRED';
 end if;
 return query
 with finals as (
  select m.* from public.matches m
  join public.divisions d on d.id=m.division_id
  join public.tournaments t on t.id=d.tournament_id
  where m.stage='final' and m.status in ('completed','walkover','bye')
   and m.winner_entry_id in (m.entry1_id,m.entry2_id)
 ), podium as (
  select f.division_id, f.winner_entry_id as recipient, 'champion'::text as rank from finals f
  union
  select f.division_id,case when f.winner_entry_id=f.entry1_id then f.entry2_id else f.entry1_id end,'runner_up' from finals f
  union
  select f.division_id,case when s.winner_entry_id=s.entry1_id then s.entry2_id else s.entry1_id end,'semifinalist'
  from finals f join public.matches s on s.division_id=f.division_id
  where s.stage='semifinal' and s.status in ('completed','walkover','bye')
   and s.winner_entry_id in (s.entry1_id,s.entry2_id)
   and s.winner_entry_id in (f.entry1_id,f.entry2_id)
   and (case when s.winner_entry_id=s.entry1_id then s.entry2_id else s.entry1_id end) not in (f.entry1_id,f.entry2_id)
 )
 select t.id,d.id,t.name::text,t.tournament_date::date,d.name::text,p.rank,e.id,
  coalesce((select jsonb_agg(coalesce(nullif(btrim(pl.nickname),''),nullif(btrim(pl.name),''),'선수') order by em.member_order,pl.id)
   from public.entry_members em join public.players pl on pl.id=em.player_id where em.entry_id=e.id),jsonb_build_array(e.display_name))
 from podium p join public.entries e on e.id=p.recipient
 join public.divisions d on d.id=p.division_id join public.tournaments t on t.id=d.tournament_id
 where exists(select 1 from public.entry_members em join public.player_accounts pa on pa.player_id=em.player_id
  where em.entry_id=e.id and pa.user_id=p_member)
 order by t.tournament_date desc nulls last,t.id,d.id;
end $$;
revoke all on function public.fwt_member_awards(uuid) from public,anon;
grant execute on function public.fwt_member_awards(uuid) to authenticated;
commit;

