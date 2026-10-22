begin;
create table public.player_accounts (
  player_id uuid primary key references public.players(id) on delete cascade,
  user_id uuid not null references public.member_profiles(id) on delete cascade,
  linked_at timestamptz not null default now(),
  linked_by uuid not null references auth.users(id)
);
create index player_accounts_user on public.player_accounts(user_id);
alter table public.player_accounts enable row level security;
revoke all on public.player_accounts from anon, authenticated;
grant select on public.player_accounts to authenticated;
create policy player_account_read on public.player_accounts for select to authenticated
using(user_id=(select auth.uid()) or (select public.is_fwt_admin()));

create function public.fwt_is_match_member(p_match uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select public.is_fwt_verified_member() and exists(
 select 1 from public.matches m join public.entry_members em on em.entry_id in(m.entry1_id,m.entry2_id)
 join public.player_accounts pa on pa.player_id=em.player_id where m.id=p_match and pa.user_id=auth.uid()); $$;
revoke all on function public.fwt_is_match_member(uuid) from public,anon;
grant execute on function public.fwt_is_match_member(uuid) to authenticated;

create table public.score_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  match_id uuid not null references public.matches(id) on delete cascade,
  submitted_by uuid not null references public.member_profiles(id),
  score1 integer not null check(score1 between 0 and 99),
  score2 integer not null check(score2 between 0 and 99 and score1<>score2),
  match_version timestamptz not null,
  status text not null default 'submitted' check(status in('submitted','approved','rejected','withdrawn')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text not null default '' check(char_length(review_note)<=500)
);
create unique index one_pending_score_per_match on public.score_submissions(match_id) where status='submitted';
create index score_submissions_match on public.score_submissions(match_id);
alter table public.score_submissions enable row level security;
revoke all on public.score_submissions from anon, authenticated;
grant select on public.score_submissions to authenticated;
create policy score_submissions_read on public.score_submissions for select to authenticated
using((select public.is_fwt_admin()) or public.fwt_is_match_member(match_id));

create function public.fwt_link_player(p_user uuid,p_player uuid) returns void
language plpgsql security definer set search_path=''
as $$ begin
 if not public.is_fwt_admin() then raise exception using errcode='42501',message='FWT_ADMIN_REQUIRED'; end if;
 if exists(select 1 from public.player_accounts where player_id=p_player and user_id<>p_user) then
   raise exception 'FWT_PLAYER_ALREADY_LINKED';
 end if;
 insert into public.player_accounts(player_id,user_id,linked_by) values(p_player,p_user,auth.uid()) on conflict(player_id) do nothing;
end $$;
revoke all on function public.fwt_link_player(uuid,uuid) from public,anon;
grant execute on function public.fwt_link_player(uuid,uuid) to authenticated;

create function public.fwt_submit_score(p_match uuid,p_score1 integer,p_score2 integer,p_request uuid) returns uuid
language plpgsql security definer set search_path=''
as $$ declare m public.matches%rowtype; s public.score_submissions%rowtype; result_id uuid; begin
 if not public.fwt_is_match_member(p_match) then raise exception using errcode='42501',message='FWT_MATCH_MEMBER_REQUIRED'; end if;
 if p_request is null or p_score1 is null or p_score2 is null or p_score1 not between 0 and 99 or p_score2 not between 0 and 99 or p_score1=p_score2 then raise exception 'FWT_INVALID_SCORE'; end if;
 select * into m from public.matches where id=p_match for update;
 select * into s from public.score_submissions where request_id=p_request;
 if found then
   if s.submitted_by=auth.uid() and s.match_id=p_match and s.score1=p_score1 and s.score2=p_score2 then return s.id; end if;
   raise exception 'FWT_REQUEST_CONFLICT';
 end if;
 if m.status<>'playing' or m.entry1_id is null or m.entry2_id is null then raise exception 'FWT_MATCH_NOT_PLAYING'; end if;
 if exists(select 1 from public.score_submissions where match_id=p_match and status='submitted') then raise exception 'FWT_SCORE_PENDING'; end if;
 insert into public.score_submissions(request_id,match_id,submitted_by,score1,score2,match_version)
 values(p_request,p_match,auth.uid(),p_score1,p_score2,m.updated_at) returning id into result_id;
 return result_id;
end $$;
revoke all on function public.fwt_submit_score(uuid,integer,integer,uuid) from public,anon;
grant execute on function public.fwt_submit_score(uuid,integer,integer,uuid) to authenticated;

create function public.fwt_withdraw_score(p_submission uuid) returns void
language plpgsql security definer set search_path=''
as $$ begin
 if not public.is_fwt_verified_member() then raise exception using errcode='42501',message='FWT_MEMBER_REQUIRED'; end if;
 update public.score_submissions set status='withdrawn',reviewed_at=now()
 where id=p_submission and submitted_by=auth.uid() and status='submitted';
 if not found then raise exception 'FWT_SUBMISSION_NOT_PENDING'; end if;
end $$;
revoke all on function public.fwt_withdraw_score(uuid) from public,anon;
grant execute on function public.fwt_withdraw_score(uuid) to authenticated;

create function public.fwt_review_score(p_submission uuid,p_approve boolean,p_note text default '') returns void
language plpgsql security definer set search_path=''
as $$ declare s public.score_submissions%rowtype; m public.matches%rowtype; winner uuid; c public.matches%rowtype;
 e1 uuid; e2 uuid; t_id uuid; begin
 if not public.is_fwt_admin() then raise exception using errcode='42501',message='FWT_ADMIN_REQUIRED'; end if;
 if p_approve is null or char_length(coalesce(p_note,''))>500 then raise exception 'FWT_INVALID_REVIEW'; end if;
 select * into s from public.score_submissions where id=p_submission;
 if not found then raise exception 'FWT_SUBMISSION_MISSING'; end if;
 -- Lock match before submission, matching the submit path's lock order.
 select * into m from public.matches where id=s.match_id for update;
 select * into s from public.score_submissions where id=p_submission for update;
 if s.status='approved' and p_approve then return; end if;
 if s.status<>'submitted' then raise exception 'FWT_SUBMISSION_NOT_PENDING'; end if;
 if not p_approve then
   update public.score_submissions set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),review_note=coalesce(p_note,'') where id=s.id;
   return;
 end if;
 if m.status<>'playing' or m.updated_at is distinct from s.match_version then raise exception 'FWT_MATCH_CHANGED'; end if;
 if not exists(select 1 from public.entry_members em join public.player_accounts pa on pa.player_id=em.player_id where em.entry_id in(m.entry1_id,m.entry2_id) and pa.user_id=s.submitted_by) then raise exception 'FWT_MEMBER_LINK_CHANGED'; end if;
 winner=case when s.score1>s.score2 then m.entry1_id else m.entry2_id end;
 update public.matches set status='completed',score1=s.score1,score2=s.score2,winner_entry_id=winner,court_id=null,completed_at=now() where id=m.id;
 -- Match the current app's advancement rule; never rewrite an already started child.
 for c in select * from public.matches where division_id=m.division_id and (source1_match_id is not null or source2_match_id is not null) order by round_number,match_number for update loop
   if c.status in('playing','completed','walkover') then continue; end if;
   e1=null; e2=null;
   select winner_entry_id into e1 from public.matches where id=c.source1_match_id and status in('completed','walkover','bye');
   select winner_entry_id into e2 from public.matches where id=c.source2_match_id and status in('completed','walkover','bye');
   if c.entry1_id is distinct from e1 or c.entry2_id is distinct from e2 or c.status is distinct from (case when e1 is not null and e2 is not null then 'waiting' else 'pending' end) then
     update public.matches set entry1_id=e1,entry2_id=e2,status=case when e1 is not null and e2 is not null then 'waiting' else 'pending' end,court_id=null where id=c.id;
   end if;
 end loop;
 if m.stage='final' then
   select tournament_id into t_id from public.divisions where id=m.division_id;
   if not exists(select 1 from public.matches x join public.divisions d on d.id=x.division_id where d.tournament_id=t_id and x.status not in('completed','walkover','bye')) then
     update public.tournaments set status='completed' where id=t_id;
   end if;
 end if;
 update public.score_submissions set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),review_note=coalesce(p_note,'') where id=s.id;
end $$;
revoke all on function public.fwt_review_score(uuid,boolean,text) from public,anon;
grant execute on function public.fwt_review_score(uuid,boolean,text) to authenticated;
commit;
