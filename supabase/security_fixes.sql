-- 보안 보완 (2026-11-06)
-- ① P0: 운영자가 숨긴 글이 신고 집계로 다시 공개되는 문제 방지
--    기존: 신고가 들어올 때마다 hidden = (신고 수 >= 3)으로 '다시 계산' → 운영자가 신고 1~2건 상태에서 숨긴 글이
--          다음 신고 때 hidden = false로 바뀌어 재공개됨.
--    수정: 운영자 숨김은 별도 칸(mod_hidden)에 두고, 신고 집계는 숨김을 '켜기만' 하고 절대 끄지 않는다.
alter table public.polls add column if not exists mod_hidden boolean not null default false;
-- 이용자는 이 칸을 읽거나 쓸 수 없다(칸 단위 권한을 주지 않음)

create or replace function public.poll_reports_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.polls p
     set report_count = (select count(*) from public.poll_reports r where r.poll_id = p.id),
         hidden = p.hidden or p.mod_hidden or (select count(*) from public.poll_reports r where r.poll_id = p.id) >= 3
   where p.id = new.poll_id;
  return null;
end $$;
revoke execute on function public.poll_reports_after_insert() from public, anon, authenticated;

-- 운영자 조치: 숨김은 두 칸 모두 켜고, 복원만 끈다. 없는 글이면 오류(조치 기록이 허공에 남지 않게).
create or replace function public.mod_poll(p_poll uuid, p_action text, p_note text default '')
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.polls where id = p_poll) then raise exception '없는 글이에요'; end if;
  if p_action = 'hide' then
    update public.polls set hidden = true, mod_hidden = true where id = p_poll;
  elsif p_action = 'restore' then
    delete from public.poll_reports where poll_id = p_poll;   -- 허위 신고 복구: 신고 초기화
    update public.polls set hidden = false, mod_hidden = false, report_count = 0 where id = p_poll;
  elsif p_action = 'delete' then
    delete from public.polls where id = p_poll;
  else
    raise exception 'action은 hide / restore / delete 중 하나';
  end if;
  insert into public.poll_moderation (poll_id, action, note) values (p_poll, p_action, coalesce(p_note, ''));
  return p_action || ' 완료';
end $$;
revoke execute on function public.mod_poll(uuid, text, text) from public, anon, authenticated;

-- 숨김 확인을 한곳에서: 투표 막기
create or replace function public.poll_votes_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.polls;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요' using errcode = '42501'; end if;
  new.user_id := auth.uid();
  new.created_at := now();
  select * into p from public.polls where id = new.poll_id;
  if not found or p.hidden or p.mod_hidden then raise exception '투표할 수 없는 여론조사예요' using errcode = 'P0001'; end if;
  if p.closes_at <= now() then raise exception '마감된 여론조사예요' using errcode = 'P0001'; end if;
  if new.option_index >= jsonb_array_length(p.options) then raise exception '없는 선택지예요' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function public.poll_votes_before_insert() from public, anon, authenticated;

-- ② P1: 공개되는 '장관 판결'을 서버에서 검증
--    여론조사에 장관 판결(minister_pick)을 붙이려면, 내 계정에 저장된 판결 기록(decision_id)을 함께 보내야 하고,
--    DB가 그 기록의 판결·선택지와 맞는지 확인한다. 남의 기록·없는 기록·맞지 않는 판결은 거부.
alter table public.polls add column if not exists decision_id uuid references public.decisions(id) on delete set null;
grant insert (decision_id) on public.polls to authenticated;

create or replace function public.polls_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare all_text text; d public.decisions; picked text; expected text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요' using errcode = '42501'; end if;
  new.user_id := auth.uid();
  new.created_at := now();
  new.closes_at := now() + make_interval(hours => new.duration_hours);
  new.report_count := 0;
  new.hidden := false;
  new.mod_hidden := false;
  new.title := btrim(new.title);
  if char_length(new.title) < 4 then
    raise exception '제목은 4자 이상 적어 주세요' using errcode = 'P0001';
  end if;
  all_text := new.title || ' ' || coalesce((select string_agg(e #>> '{}', ' ') from jsonb_array_elements(new.options) e), '');
  if all_text ~ '01[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4}' or all_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    raise exception '전화번호·이메일 같은 개인정보는 올릴 수 없어요' using errcode = 'P0001';
  end if;
  if new.minister_pick is not null then
    if new.minister_pick >= jsonb_array_length(new.options) then
      raise exception '없는 선택지예요' using errcode = 'P0001';
    end if;
    select * into d from public.decisions where id = new.decision_id and user_id = auth.uid();
    if not found then raise exception '장관 판결을 확인할 수 없어요' using errcode = 'P0001'; end if;
    picked := btrim(new.options ->> new.minister_pick::int);
    if d.category = '쇼핑' then
      expected := case when d.verdict = '구매 승인!' then '산다' else '안 산다' end;
      if picked <> expected then raise exception '장관 판결을 확인할 수 없어요' using errcode = 'P0001'; end if;
    elsif d.verdict <> picked || '!' then
      raise exception '장관 판결을 확인할 수 없어요' using errcode = 'P0001';
    end if;
  else
    new.decision_id := null; -- 판결 표시가 없으면 기록 연결도 하지 않는다
  end if;
  if (select count(*) from public.polls where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception '여론조사는 하루에 5개까지 올릴 수 있어요' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.polls_before_insert() from public, anon, authenticated;

-- 공개 목록: 글쓴이에게는 '숨김 상태'를 알려 준다(다른 사람에게는 숨긴 글 자체가 안 보임)
drop function if exists public.poll_board(integer);
create function public.poll_board(p_limit integer default 60)
returns table (id uuid, title text, category text, options jsonb, created_at timestamptz, closes_at timestamptz,
               is_open boolean, counts integer[], total integer, mine boolean, my_vote smallint, reported boolean,
               minister_pick smallint, is_hidden boolean)
language sql stable security definer set search_path = '' as $$
  with base as (
    select p.*,
           (p.closes_at > now()) as open_now,
           (p.hidden or p.mod_hidden) as hid,
           (select v.option_index from public.poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()) as my_v
      from public.polls p
     where (not (p.hidden or p.mod_hidden) or p.user_id = auth.uid())
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
         b.minister_pick,
         (b.hid and b.user_id = auth.uid()) as is_hidden
    from base b
   order by b.open_now desc,
            case when b.open_now then b.closes_at end asc,
            b.closes_at desc
   limit least(greatest(coalesce(p_limit, 60), 1), 100)
$$;
revoke execute on function public.poll_board(integer) from public;
grant execute on function public.poll_board(integer) to anon, authenticated;

-- ③ P1: 근거 조회 API 호출 제한을 모든 서버 인스턴스가 함께 쓰도록(DB 공용 카운터)
--    서버 함수가 IP를 비밀값으로 해시한 키만 보낸다(IP 원문은 저장하지 않음). 1분 창, 오래된 줄은 자동 정리.
create table if not exists public.api_hits (
  k   text not null,
  win timestamptz not null,
  n   integer not null default 0,
  primary key (k, win)
);
alter table public.api_hits enable row level security; -- 정책 없음 = 직접 접근 불가
revoke all on public.api_hits from anon, authenticated;

create or replace function public.api_hit(p_key text, p_limit integer default 60)
returns boolean language plpgsql security definer set search_path = '' as $$
declare w timestamptz := date_trunc('minute', now()); c integer;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then return false; end if;  -- 해시 키만 받는다
  insert into public.api_hits (k, win, n) values (p_key, w, 1)
    on conflict (k, win) do update set n = public.api_hits.n + 1
    returning n into c;
  if random() < 0.02 then delete from public.api_hits where win < now() - interval '10 minutes'; end if;
  return c <= least(greatest(coalesce(p_limit, 60), 1), 200);
end $$;
revoke execute on function public.api_hit(text, integer) from public, anon, authenticated;
-- 켜는 방법: Vercel 환경변수 RATE_SALT(임의의 긴 문자열)를 등록한 뒤 아래 한 줄을 실행한다.
--   grant execute on function public.api_hit(text, integer) to anon;
-- (2026-11-06 현재: RATE_SALT 미등록 → 실행 권한을 꺼 두고, 서버 인스턴스별 제한만 동작)
