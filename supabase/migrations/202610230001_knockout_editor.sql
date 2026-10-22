begin;
create or replace function public.fwt_knockout_edit_state(p_division uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb; rev text;
begin
 if not public.is_fwt_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if not exists(select 1 from public.divisions where id=p_division) then raise exception 'DIVISION_NOT_FOUND'; end if;
 select md5(coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb)::text) into rev from public.matches m where m.division_id=p_division and m.stage<>'group';
 select jsonb_build_object('division',to_jsonb(d),'tournament',jsonb_build_object('id',t.id,'name',t.name),'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.display_name) order by e.sort_order,e.created_at,e.id) from public.entries e where e.division_id=d.id),'[]'::jsonb),'matches',coalesce((select jsonb_agg(to_jsonb(m) order by m.round_number,m.match_number) from public.matches m where m.division_id=d.id and m.stage<>'group'),'[]'::jsonb),'revision',rev,'locked',exists(select 1 from public.matches m where m.division_id=d.id and m.stage<>'group' and (m.status not in('pending','waiting','bye') or m.started_at is not null or m.completed_at is not null or m.score1 is not null or m.score2 is not null or (m.winner_entry_id is not null and m.status<>'bye'))) or exists(select 1 from public.score_submissions s join public.matches m on m.id=s.match_id where m.division_id=d.id and m.stage<>'group' and s.status in('submitted','approved'))) into state from public.divisions d join public.tournaments t on t.id=d.tournament_id where d.id=p_division;
 return state;
end $$;
create or replace function public.fwt_save_knockout_positions(p_division uuid,p_slots uuid[],p_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb; fmt text; pool uuid[]; chosen uuid[]; oldpool uuid[]; size int; rounds int:=0; cnt int; r int; n int; mid uuid; previous_ids uuid[]; current_ids uuid[]; e1 uuid; e2 uuid; w uuid; s text; sources record; expected_count int; existing_count int;
begin
 if not public.is_fwt_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 lock table public.matches in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtextextended(p_division::text,0));
 perform 1 from public.divisions where id=p_division for update;
 if not found then raise exception 'DIVISION_NOT_FOUND'; end if;
 perform 1 from public.matches where division_id=p_division and stage<>'group' order by round_number,match_number for update;
 state:=public.fwt_knockout_edit_state(p_division);
 if state->>'revision' is distinct from p_revision then raise exception 'STALE_BRACKET'; end if;
 if (state->>'locked')::boolean then raise exception 'BRACKET_STARTED_OR_SCORED'; end if;
 fmt:=state->'division'->>'format';
 size:=coalesce(array_length(p_slots,1),0);
 if size<2 or size>128 or (size & (size-1))<>0 then raise exception 'INVALID_BRACKET_SIZE'; end if;
 select array_agg(x order by x) into chosen from unnest(p_slots) x where x is not null;
 if cardinality(chosen)<2 or cardinality(chosen)<>(select count(distinct x) from unnest(p_slots) x where x is not null) then raise exception 'DUPLICATE_OR_MISSING_TEAM'; end if;
 if exists(select 1 from unnest(p_slots) x where x is not null and not exists(select 1 from public.entries e where e.id=x and e.division_id=p_division)) then raise exception 'FOREIGN_TEAM'; end if;
 for n in 1..size/2 loop if p_slots[n*2-1] is null and p_slots[n*2] is null then raise exception 'EMPTY_MATCH'; end if; end loop;
 select count(*) into existing_count from public.matches where division_id=p_division and stage<>'group';
 if existing_count>0 then
  select array_agg(x order by x) into oldpool from (select entry1_id as x from public.matches where division_id=p_division and stage<>'group' and round_number=1 union all select entry2_id from public.matches where division_id=p_division and stage<>'group' and round_number=1) a where x is not null;
  if oldpool is distinct from chosen then raise exception 'TEAM_POOL_CHANGED'; end if;
  if existing_count<>size-1 then raise exception 'BRACKET_SHAPE_CHANGED'; end if;
 else
  if fmt='knockout' then
   select array_agg(id order by id) into pool from public.entries where division_id=p_division;
   if pool is distinct from chosen then raise exception 'TEAM_POOL_CHANGED'; end if;
  end if;
 end if;
 cnt:=size;while cnt>1 loop rounds:=rounds+1;cnt:=cnt/2;end loop;
 for r in 1..rounds loop
  current_ids:=array[]::uuid[];
  for n in 1..(size/power(2,r)::int) loop
   e1:=null;e2:=null;w:=null;s:='pending';
   if r=1 then e1:=p_slots[n*2-1];e2:=p_slots[n*2];else
    select a.winner_entry_id as w1,b.winner_entry_id as w2 into sources from public.matches a,public.matches b where a.id=previous_ids[n*2-1] and b.id=previous_ids[n*2];
    e1:=sources.w1;e2:=sources.w2;
   end if;
   if e1 is not null and e2 is not null then s:='waiting';elsif r=1 then s:='bye';w:=coalesce(e1,e2);end if;
   if existing_count>0 then
    update public.matches set entry1_id=e1,entry2_id=e2,winner_entry_id=w,status=s,score1=null,score2=null,started_at=null,completed_at=null,source1_match_id=case when r>1 then previous_ids[n*2-1] end,source2_match_id=case when r>1 then previous_ids[n*2] end where division_id=p_division and stage<>'group' and round_number=r and match_number=n returning id into mid;
    if not found then raise exception 'BRACKET_SHAPE_CHANGED'; end if;
   else
    insert into public.matches(division_id,stage,round_number,match_number,entry1_id,entry2_id,winner_entry_id,status,source1_match_id,source2_match_id,sort_order) values(p_division,case size/power(2,r-1)::int when 2 then 'final' when 4 then 'semifinal' when 8 then 'quarterfinal' when 16 then 'round16' else 'round32' end,r,n,e1,e2,w,s,case when r>1 then previous_ids[n*2-1] end,case when r>1 then previous_ids[n*2] end,10000+(size-size/power(2,r-1)::int)+n-1) returning id into mid;
   end if;
   current_ids:=array_append(current_ids,mid);
  end loop;
  previous_ids:=current_ids;
 end loop;
 return public.fwt_knockout_edit_state(p_division);
end $$;
revoke all on function public.fwt_knockout_edit_state(uuid) from public,anon;
revoke all on function public.fwt_save_knockout_positions(uuid,uuid[],text) from public,anon;
grant execute on function public.fwt_knockout_edit_state(uuid) to authenticated;
grant execute on function public.fwt_save_knockout_positions(uuid,uuid[],text) to authenticated;
commit;
