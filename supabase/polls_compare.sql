-- =====================================================================
-- 국민 여론: '장관 판결 vs 국민 여론' 비교 (2026-11-06 적용)
--  * 판결 화면에서 여론조사를 올리면, 장관 판결이 몇 번째 선택지였는지(minister_pick)를 함께 저장한다.
--  * 범위 밖 번호는 DB가 거부한다. 작성자가 값을 임의로 넣을 수는 있지만 자기 글에 대한 표시일 뿐이며
--    투표 집계에는 영향이 없다(한계로 문서화).
--  * 공개 함수 poll_board()가 이 값을 함께 돌려준다. 작성자·투표자 정보는 여전히 내보내지 않는다.
-- =====================================================================
alter table public.polls add column if not exists minister_pick smallint check (minister_pick is null or minister_pick between 0 and 5);

create or replace function public.polls_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요' using errcode = '42501'; end if;
  new.user_id := auth.uid();
  new.created_at := now();
  new.closes_at := now() + make_interval(hours => new.duration_hours);
  new.report_count := 0;
  new.hidden := false;
  new.title := btrim(new.title);
  if new.minister_pick is not null and new.minister_pick >= jsonb_array_length(new.options) then
    raise exception '없는 선택지예요' using errcode = 'P0001';
  end if;
  if (select count(*) from public.polls where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception '여론조사는 하루에 5개까지 올릴 수 있어요' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.polls_before_insert() from public, anon, authenticated;

grant insert (minister_pick) on public.polls to authenticated;
grant select (minister_pick) on public.polls to authenticated;

drop function if exists public.poll_board(integer);
create function public.poll_board(p_limit integer default 60)
returns table (id uuid, title text, category text, options jsonb, created_at timestamptz, closes_at timestamptz,
               is_open boolean, counts integer[], total integer, mine boolean, my_vote smallint, reported boolean,
               minister_pick smallint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.title, p.category, p.options, p.created_at, p.closes_at,
         p.closes_at > now() as is_open,
         array(select (select count(*) from public.poll_votes v where v.poll_id = p.id and v.option_index = i)::integer
               from generate_series(0, jsonb_array_length(p.options) - 1) i) as counts,
         (select count(*) from public.poll_votes v where v.poll_id = p.id)::integer as total,
         (p.user_id = auth.uid()) as mine,
         (select v.option_index from public.poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()) as my_vote,
         exists (select 1 from public.poll_reports r where r.poll_id = p.id and r.user_id = auth.uid()) as reported,
         p.minister_pick
    from public.polls p
   where (not p.hidden or p.user_id = auth.uid())
     and p.closes_at > now() - interval '30 days'
   order by (p.closes_at > now()) desc,
            case when p.closes_at > now() then p.closes_at end asc,
            p.closes_at desc
   limit least(greatest(coalesce(p_limit, 60), 1), 100)
$$;
revoke execute on function public.poll_board(integer) from public;
grant execute on function public.poll_board(integer) to anon, authenticated;
