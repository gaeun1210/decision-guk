-- 정식 제출 전 수정(2026-11-06): 인수인계서 POLL-01 · POLL-02
-- ① POLL-01: 진행 중인 여론은 '투표한 사람 · 글쓴이'에게만 선택지별 득표수를 돌려준다.
--    다른 사람(비로그인 포함)에게는 counts = null. 총 참여 인원(total)은 공개(정책 결정: 참여 열기만 보여 줌).
drop function if exists public.poll_board(integer);
create function public.poll_board(p_limit integer default 60)
returns table (id uuid, title text, category text, options jsonb, created_at timestamptz, closes_at timestamptz,
               is_open boolean, counts integer[], total integer, mine boolean, my_vote smallint, reported boolean,
               minister_pick smallint)
language sql stable security definer set search_path = '' as $$
  with base as (
    select p.*,
           (p.closes_at > now()) as open_now,
           (select v.option_index from public.poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()) as my_v
      from public.polls p
     where (not p.hidden or p.user_id = auth.uid())
       and p.closes_at > now() - interval '30 days'
  )
  select b.id, b.title, b.category, b.options, b.created_at, b.closes_at,
         b.open_now as is_open,
         case when (not b.open_now) or b.my_v is not null or b.user_id = auth.uid() then
           array(select (select count(*) from public.poll_votes v where v.poll_id = b.id and v.option_index = i)::integer
                 from generate_series(0, jsonb_array_length(b.options) - 1) i)
         end as counts,
         (select count(*) from public.poll_votes v where v.poll_id = b.id)::integer as total,
         (b.user_id = auth.uid()) as mine,
         b.my_v as my_vote,
         exists (select 1 from public.poll_reports r where r.poll_id = b.id and r.user_id = auth.uid()) as reported,
         b.minister_pick
    from base b
   order by b.open_now desc,
            case when b.open_now then b.closes_at end asc,
            b.closes_at desc
   limit least(greatest(coalesce(p_limit, 60), 1), 100)
$$;
revoke execute on function public.poll_board(integer) from public;
grant execute on function public.poll_board(integer) to anon, authenticated;

-- ② POLL-02: 신고 사유(개인정보·욕설·광고·기타)
alter table public.poll_reports add column if not exists reason text not null default '기타'
  check (reason in ('개인정보', '욕설', '광고', '기타'));
grant insert (poll_id, reason) on public.poll_reports to authenticated;

-- ③ POLL-02: 운영자 조치(숨김·복원) 기록. 일반 이용자(anon/authenticated)는 테이블·함수 모두 접근 불가.
--    운영자는 Supabase 대시보드 SQL Editor에서만 실행한다(아래 사용 예).
create table if not exists public.poll_moderation (
  id         bigint generated always as identity primary key,
  poll_id    uuid not null,
  action     text not null check (action in ('hide', 'restore', 'delete')),
  note       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.poll_moderation enable row level security; -- 정책 없음 = 이용자 접근 0
revoke all on public.poll_moderation from anon, authenticated;

create or replace function public.mod_poll(p_poll uuid, p_action text, p_note text default '')
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_action = 'hide' then
    update public.polls set hidden = true where id = p_poll;
  elsif p_action = 'restore' then
    update public.polls set hidden = false where id = p_poll;
    delete from public.poll_reports where poll_id = p_poll;   -- 허위 신고 복구: 신고 수 초기화
    update public.polls set report_count = 0 where id = p_poll;
  elsif p_action = 'delete' then
    delete from public.polls where id = p_poll;
  else
    raise exception 'action은 hide / restore / delete 중 하나';
  end if;
  insert into public.poll_moderation (poll_id, action, note) values (p_poll, p_action, coalesce(p_note, ''));
  return p_action || ' 완료';
end $$;
revoke execute on function public.mod_poll(uuid, text, text) from public, anon, authenticated;

-- 운영자 사용 예 (SQL Editor):
--   신고 목록:  select p.id, p.title, p.hidden, r.reason, count(*) from public.polls p
--                 join public.poll_reports r on r.poll_id = p.id group by 1,2,3,4 order by 5 desc;
--   숨기기:     select public.mod_poll('<글 id>', 'hide', '개인정보 포함');
--   복원:       select public.mod_poll('<글 id>', 'restore', '허위 신고');
--   조치 기록:  select * from public.poll_moderation order by created_at desc;

-- ④ POLL-02: 작성 전 최소 입력 · 개인정보(전화번호·이메일) 차단을 DB에서도 강제(화면 검사를 우회해도 막힘)
create or replace function public.polls_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare all_text text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요' using errcode = '42501'; end if;
  new.user_id := auth.uid();
  new.created_at := now();
  new.closes_at := now() + make_interval(hours => new.duration_hours);
  new.report_count := 0;
  new.hidden := false;
  new.title := btrim(new.title);
  if char_length(new.title) < 4 then
    raise exception '제목은 4자 이상 적어 주세요' using errcode = 'P0001';
  end if;
  all_text := new.title || ' ' || coalesce((select string_agg(e #>> '{}', ' ') from jsonb_array_elements(new.options) e), '');
  if all_text ~ '01[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4}' or all_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    raise exception '전화번호·이메일 같은 개인정보는 올릴 수 없어요' using errcode = 'P0001';
  end if;
  if new.minister_pick is not null and new.minister_pick >= jsonb_array_length(new.options) then
    raise exception '없는 선택지예요' using errcode = 'P0001';
  end if;
  if (select count(*) from public.polls where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception '여론조사는 하루에 5개까지 올릴 수 있어요' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.polls_before_insert() from public, anon, authenticated;
