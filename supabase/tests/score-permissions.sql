begin;
-- Append inside the migration test transaction. All fixtures are rolled back.
insert into auth.users(id,email,email_confirmed_at,aud,role,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values('a1111111-1111-4111-8111-111111111111','fwt-test-one@example.invalid',now(),'authenticated','authenticated','{}','{}',false,now(),now()),
('a2222222-2222-4222-8222-222222222222','fwt-test-two@example.invalid',now(),'authenticated','authenticated','{}','{}',false,now(),now());
insert into public.member_profiles(id,nickname,age_band,tennis_since,directory_consent)
values('a2222222-2222-4222-8222-222222222222','FWT_TEST_OTHER_20261022','private','2020-01-01',true);
insert into public.tournaments(id,name,tournament_date,status,is_public,created_by)
select 'b1111111-1111-4111-8111-111111111111','FWT ROLLBACK TEST',current_date,'draft',true,user_id from public.fwt_admin_accounts limit 1;
insert into public.divisions(id,tournament_id,name,match_type,gender,format,group_count,advance_count,wildcard_count,expected_match_minutes,sort_order)
values('b2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','TEST','singles','open','knockout',1,1,0,30,0);
insert into public.players(id,name,nickname) values
('c1111111-1111-4111-8111-111111111111','TEST A','TEST A'),('c2222222-2222-4222-8222-222222222222','TEST B','TEST B'),('c3333333-3333-4333-8333-333333333333','TEST C','TEST C'),('c4444444-4444-4444-8444-444444444444','TEST D','TEST D');
insert into public.entries(id,division_id,display_name,status,sort_order) values
('d1111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222','TEST A','active',1),('d2222222-2222-4222-8222-222222222222','b2222222-2222-4222-8222-222222222222','TEST B','active',2),('d3333333-3333-4333-8333-333333333333','b2222222-2222-4222-8222-222222222222','TEST C','active',3),('d4444444-4444-4444-8444-444444444444','b2222222-2222-4222-8222-222222222222','TEST D','active',4);
insert into public.entry_members(entry_id,player_id,member_order) values
('d1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111',1),('d2222222-2222-4222-8222-222222222222','c2222222-2222-4222-8222-222222222222',1),('d3333333-3333-4333-8333-333333333333','c3333333-3333-4333-8333-333333333333',1),('d4444444-4444-4444-8444-444444444444','c4444444-4444-4444-8444-444444444444',1);
insert into public.matches(id,division_id,stage,round_number,match_number,entry1_id,entry2_id,status,sort_order) values
('e1111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222','semifinal',1,1,'d1111111-1111-4111-8111-111111111111','d2222222-2222-4222-8222-222222222222','playing',1),
('e2222222-2222-4222-8222-222222222222','b2222222-2222-4222-8222-222222222222','semifinal',1,2,'d3333333-3333-4333-8333-333333333333','d4444444-4444-4444-8444-444444444444','completed',2);
update public.matches set winner_entry_id='d3333333-3333-4333-8333-333333333333',score1=6,score2=1 where id='e2222222-2222-4222-8222-222222222222';
insert into public.matches(id,division_id,stage,round_number,match_number,source1_match_id,source2_match_id,status,sort_order)
values('e3333333-3333-4333-8333-333333333333','b2222222-2222-4222-8222-222222222222','final',2,1,'e1111111-1111-4111-8111-111111111111','e2222222-2222-4222-8222-222222222222','pending',3);

set local role anon;
do $$ begin
 if (select count(*) from public.tournaments where id='b1111111-1111-4111-8111-111111111111')<>1 then raise exception 'FAIL public tournament read'; end if;
 begin perform 1 from public.member_profiles;raise exception 'FAIL anonymous profile access';exception when insufficient_privilege then null;end;
 begin delete from public.tournaments where id='b1111111-1111-4111-8111-111111111111';raise exception 'FAIL anonymous delete';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select public.fwt_save_member_profile('FWT_TEST_MEMBER_20261022','1990-05-10','2020-01-01',true);
do $$ begin
 if public.fwt_member_profile()->>'birth_date'<>'1990-05-10' then raise exception 'FAIL own birth date read';end if;
 begin perform birth_date from public.member_profiles;raise exception 'FAIL directory birthday leak';exception when insufficient_privilege then null;end;
 begin perform public.fwt_member_profile('a2222222-2222-4222-8222-222222222222');raise exception 'FAIL other private profile read';exception when insufficient_privilege then null;end;
 begin perform public.fwt_save_member_profile('FWT_TEST_MEMBER_20261022','2999-01-01','2020-01-01',true);raise exception 'FAIL future birthday';exception when others then if sqlerrm<>'FWT_INVALID_BIRTH_DATE' then raise;end if;end;
end $$;

do $$ declare count_changed int;begin
 if (select count(*) from public.member_profiles where id='a2222222-2222-4222-8222-222222222222')<>1 then raise exception 'FAIL verified directory read';end if;
 begin update public.member_profiles set nickname='UNAUTHORIZED' where id='a2222222-2222-4222-8222-222222222222';raise exception 'FAIL direct profile update';exception when insufficient_privilege then null;end;
 update public.matches set score1=99 where id='e1111111-1111-4111-8111-111111111111';get diagnostics count_changed=row_count;
 if count_changed<>0 then raise exception 'FAIL member official score update';end if;
 begin perform public.fwt_submit_score('e1111111-1111-4111-8111-111111111111',6,2,'f1111111-1111-4111-8111-111111111111');raise exception 'FAIL unlinked submit';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.fwt_admin_accounts limit 1),'role','authenticated')::text,true);
select set_config('request.jwt.claim.sub',(select user_id::text from public.fwt_admin_accounts limit 1),true);
set local role authenticated;
select public.fwt_link_player('a1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111');
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$ declare first_id uuid;second_id uuid;begin
 first_id=public.fwt_submit_score('e1111111-1111-4111-8111-111111111111',6,2,'f1111111-1111-4111-8111-111111111111');
 second_id=public.fwt_submit_score('e1111111-1111-4111-8111-111111111111',6,2,'f1111111-1111-4111-8111-111111111111');
 if first_id<>second_id then raise exception 'FAIL idempotency';end if;
 begin perform public.fwt_submit_score('e1111111-1111-4111-8111-111111111111',6,3,'f2222222-2222-4222-8222-222222222222');raise exception 'FAIL duplicate pending';exception when others then if sqlerrm<>'FWT_SCORE_PENDING' then raise;end if;end;
 begin perform public.fwt_review_score(first_id,true,'');raise exception 'FAIL member approval';exception when insufficient_privilege then null;end;
 perform public.fwt_withdraw_score(first_id);
 perform public.fwt_submit_score('e1111111-1111-4111-8111-111111111111',6,2,'f2222222-2222-4222-8222-222222222222');
end $$;
select set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.score_submissions where match_id='e1111111-1111-4111-8111-111111111111') then raise exception 'FAIL outsider submission read';end if;
 begin perform public.fwt_submit_score('e1111111-1111-4111-8111-111111111111',1,6,'f3333333-3333-4333-8333-333333333333');raise exception 'FAIL outsider submit';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.fwt_admin_accounts limit 1),'role','authenticated')::text,true);
select set_config('request.jwt.claim.sub',(select user_id::text from public.fwt_admin_accounts limit 1),true);
set local role authenticated;
select public.fwt_review_score((select id from public.score_submissions where request_id='f2222222-2222-4222-8222-222222222222'),true,'TEST APPROVED');
do $$ begin
 if not exists(select 1 from public.matches where id='e1111111-1111-4111-8111-111111111111' and status='completed' and score1=6 and score2=2 and winner_entry_id='d1111111-1111-4111-8111-111111111111') then raise exception 'FAIL official result';end if;
 if not exists(select 1 from public.matches where id='e3333333-3333-4333-8333-333333333333' and status='waiting' and entry1_id='d1111111-1111-4111-8111-111111111111' and entry2_id='d3333333-3333-4333-8333-333333333333') then raise exception 'FAIL knockout advancement';end if;
end $$;
reset role;
rollback;
select 'PASS: anonymous access, own profile, other profile protection, direct score protection, unlinked protection, idempotency, duplicate pending, withdraw, outsider access, admin approval, knockout advancement. ALL TEST FIXTURES ROLLED BACK.' as result;


