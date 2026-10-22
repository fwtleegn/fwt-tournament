begin;
insert into public.tournaments(id,name,tournament_date,status,is_public,created_by) select 'b8111111-1111-4111-8111-111111111111','FWT_EDITOR_ROLLBACK_ONLY',current_date,'draft',true,user_id from public.fwt_admin_accounts limit 1;
insert into public.divisions(id,tournament_id,name,match_type,gender,format,group_count,advance_count,wildcard_count,expected_match_minutes,sort_order) values('b8222222-2222-4222-8222-222222222222','b8111111-1111-4111-8111-111111111111','EDITOR TEST','singles','open','knockout',1,1,0,30,0);
insert into public.entries(id,division_id,display_name,status,sort_order) values('d8111111-1111-4111-8111-111111111111','b8222222-2222-4222-8222-222222222222','TEST A','active',0),('d8222222-2222-4222-8222-222222222222','b8222222-2222-4222-8222-222222222222','TEST B','active',1),('d8333333-3333-4333-8333-333333333333','b8222222-2222-4222-8222-222222222222','TEST C','active',2);
select set_config('request.jwt.claim.sub',(select user_id::text from public.fwt_admin_accounts limit 1),true);
set local role authenticated;
do $$ declare d uuid:='b8222222-2222-4222-8222-222222222222'; a uuid:='d8111111-1111-4111-8111-111111111111';b uuid:='d8222222-2222-4222-8222-222222222222';c uuid:='d8333333-3333-4333-8333-333333333333'; state jsonb; rev text;ids uuid[];begin
 state:=public.fwt_knockout_edit_state(d);rev:=state->>'revision';
 state:=public.fwt_save_knockout_positions(d,array[a,b,c,null],rev);
 if jsonb_array_length(state->'matches')<>3 then raise exception 'FAIL create';end if;
 select array_agg(id order by id) into ids from public.matches where division_id=d;
 begin perform public.fwt_save_knockout_positions(d,array[a,null,b,c],rev);raise exception 'FAIL stale accepted';exception when others then if sqlerrm<>'STALE_BRACKET' then raise;end if;end;
 state:=public.fwt_save_knockout_positions(d,array[a,null,b,c],state->>'revision');
 if ids is distinct from (select array_agg(id order by id) from public.matches where division_id=d) then raise exception 'FAIL changed match ids';end if;
 if not exists(select 1 from public.matches where division_id=d and round_number=1 and match_number=1 and status='bye' and winner_entry_id=a and entry2_id is null) then raise exception 'FAIL BYE swap';end if;
 if not exists(select 1 from public.matches where division_id=d and round_number=2 and entry1_id=a and entry2_id is null and status='pending') then raise exception 'FAIL advancement';end if;
 begin perform public.fwt_save_knockout_positions(d,array[a,a,b,null],state->>'revision');raise exception 'FAIL duplicate accepted';exception when others then if sqlerrm<>'DUPLICATE_OR_MISSING_TEAM' then raise;end if;end;
 begin perform public.fwt_save_knockout_positions(d,array[a,b,null,null],state->>'revision');raise exception 'FAIL empty accepted';exception when others then if sqlerrm<>'EMPTY_MATCH' then raise;end if;end;
 update public.matches set status='playing',started_at=now() where division_id=d and round_number=1 and match_number=2;
 state:=public.fwt_knockout_edit_state(d);
 begin perform public.fwt_save_knockout_positions(d,array[a,b,c,null],state->>'revision');raise exception 'FAIL started accepted';exception when others then if sqlerrm<>'BRACKET_STARTED_OR_SCORED' then raise;end if;end;
 update public.matches set status='waiting',started_at=null,score1=6,score2=2 where division_id=d and round_number=1 and match_number=2;
 state:=public.fwt_knockout_edit_state(d);
 begin perform public.fwt_save_knockout_positions(d,array[a,b,c,null],state->>'revision');raise exception 'FAIL scored accepted';exception when others then if sqlerrm<>'BRACKET_STARTED_OR_SCORED' then raise;end if;end;
end $$;
reset role;
update public.matches set score1=null,score2=null where division_id='b8222222-2222-4222-8222-222222222222';
insert into public.score_submissions(request_id,match_id,submitted_by,score1,score2,match_version) select gen_random_uuid(),m.id,(select id from public.member_profiles limit 1),6,2,m.updated_at from public.matches m where m.division_id='b8222222-2222-4222-8222-222222222222' and m.round_number=1 and m.match_number=2;
set local role authenticated;
do $$ declare state jsonb;begin
state:=public.fwt_knockout_edit_state('b8222222-2222-4222-8222-222222222222');
begin perform public.fwt_save_knockout_positions('b8222222-2222-4222-8222-222222222222',array['d8111111-1111-4111-8111-111111111111'::uuid,null,'d8222222-2222-4222-8222-222222222222'::uuid,'d8333333-3333-4333-8333-333333333333'::uuid],state->>'revision');raise exception 'FAIL submitted accepted';exception when others then if sqlerrm<>'BRACKET_STARTED_OR_SCORED' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','a8111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$ begin
 begin perform public.fwt_knockout_edit_state('b8222222-2222-4222-8222-222222222222');raise exception 'FAIL member read accepted';exception when others then if sqlerrm<>'ADMIN_REQUIRED' then raise;end if;end;
 begin perform public.fwt_save_knockout_positions('b8222222-2222-4222-8222-222222222222',array[]::uuid[],'');raise exception 'FAIL member save accepted';exception when others then if sqlerrm<>'ADMIN_REQUIRED' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.fwt_knockout_edit_state('b8222222-2222-4222-8222-222222222222');raise exception 'FAIL anon read accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS_KNOCKOUT_EDITOR_ROLLBACK_TESTS' as result;
