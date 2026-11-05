-- =====================================================================
-- 📮 국민 여론 광장 — 공개 여론조사 (2026-11-05 적용)
-- 설계 원칙
--  * 보기: 누구나(비로그인 포함). 단, 공개되는 것은 제목·선택지·마감·표 '합계'뿐.
--    누가 글을 썼는지(user_id), 누가 어디에 투표했는지는 공개하지 않는다.
--  * 글쓰기·투표·신고: 로그인한 사용자만. 1인 1표, 마감 후 투표 불가, 없는 선택지 불가.
--  * 마감 시각·작성 시각은 화면이 보낸 값을 믿지 않고 DB가 직접 정한다.
--  * 남의 글은 지울 수 없고, 글·표는 수정할 수 없다(UPDATE 권한 없음).
--  * 악용 대응: 계정당 하루 5개 작성 제한, 신고 3건이면 자동 숨김.
--  * 모든 규칙은 DB(제약·트리거·RLS)가 막으므로 콘솔에서 직접 요청해도 우회할 수 없다.
-- =====================================================================

-- 선택지 검사: 문자열 2~6개, 각 1~40자, 중복 없음
create or replace function public.poll_options_ok(o jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(o) = 'array'
     and jsonb_array_length(o) between 2 and 6
     and not exists (select 1 from jsonb_array_elements(o) e
                     where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 1 and 40)
     and (select count(distinct btrim(e #>> '{}')) from jsonb_array_elements(o) e) = jsonb_array_length(o)
$$;

create table if not exists public.polls (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 100),
  category       text not null default '일상' check (category in ('나들이', '맛집', '쇼핑', '일상')),
  options        jsonb not null check (public.poll_options_ok(options)),
  duration_hours smallint not null check (duration_hours in (1, 24, 72, 168)),
  created_at     timestamptz not null default now(),
  closes_at      timestamptz not null,
  report_count   integer not null default 0,
  hidden         boolean not null default false
);
create index if not exists polls_closes_idx on public.polls (closes_at desc);
create index if not exists polls_user_idx on public.polls (user_id, created_at desc);

create table if not exists public.poll_votes (
  poll_id      uuid not null references public.polls(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  option_index smallint not null check (option_index between 0 and 5),
  created_at   timestamptz not null default now(),
  primary key (poll_id, user_id)            -- 1인 1표
);

create table if not exists public.poll_reports (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)            -- 한 사람이 같은 글을 여러 번 신고해도 1건
);
create index if not exists poll_votes_user_idx on public.poll_votes (user_id);
create index if not exists poll_reports_user_idx on public.poll_reports (user_id);

-- 글 작성: 작성자·시각·마감을 DB가 정하고, 하루 5개를 넘으면 거부
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
  if (select count(*) from public.polls where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception '여론조사는 하루에 5개까지 올릴 수 있어요' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists polls_before_insert on public.polls;
create trigger polls_before_insert before insert on public.polls for each row execute function public.polls_before_insert();

-- 투표: 진행 중·공개 상태·존재하는 선택지인지 DB가 확인
create or replace function public.poll_votes_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.polls;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요' using errcode = '42501'; end if;
  new.user_id := auth.uid();
  new.created_at := now();
  select * into p from public.polls where id = new.poll_id;
  if not found or p.hidden then raise exception '투표할 수 없는 여론조사예요' using errcode = 'P0001'; end if;
  if p.closes_at <= now() then raise exception '마감된 여론조사예요' using errcode = 'P0001'; end if;
  if new.option_index >= jsonb_array_length(p.options) then raise exception '없는 선택지예요' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists poll_votes_before_insert on public.poll_votes;
create trigger poll_votes_before_insert before insert on public.poll_votes for each row execute function public.poll_votes_before_insert();

-- 신고: 자기 글은 신고 불가, 3건이 쌓이면 자동으로 숨김
create or replace function public.poll_reports_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요' using errcode = '42501'; end if;
  new.user_id := auth.uid();
  if not exists (select 1 from public.polls where id = new.poll_id) then raise exception '없는 여론조사예요' using errcode = 'P0001'; end if;
  if exists (select 1 from public.polls where id = new.poll_id and user_id = new.user_id) then
    raise exception '내 글은 신고할 수 없어요' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace function public.poll_reports_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.polls p
     set report_count = (select count(*) from public.poll_reports r where r.poll_id = p.id),
         hidden = (select count(*) from public.poll_reports r where r.poll_id = p.id) >= 3
   where p.id = new.poll_id;
  return null;
end $$;
drop trigger if exists poll_reports_before_insert on public.poll_reports;
drop trigger if exists poll_reports_after_insert on public.poll_reports;
create trigger poll_reports_before_insert before insert on public.poll_reports for each row execute function public.poll_reports_before_insert();
create trigger poll_reports_after_insert after insert on public.poll_reports for each row execute function public.poll_reports_after_insert();

-- RLS: 테이블에 직접 접근할 때는 '내 것'만
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
alter table public.poll_reports enable row level security;

drop policy if exists polls_select_own on public.polls;
drop policy if exists polls_insert_own on public.polls;
drop policy if exists polls_delete_own on public.polls;
create policy polls_select_own on public.polls for select to authenticated using ((select auth.uid()) = user_id);
create policy polls_insert_own on public.polls for insert to authenticated with check ((select auth.uid()) = user_id);
create policy polls_delete_own on public.polls for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists poll_votes_select_own on public.poll_votes;
drop policy if exists poll_votes_insert_own on public.poll_votes;
create policy poll_votes_select_own on public.poll_votes for select to authenticated using ((select auth.uid()) = user_id);
create policy poll_votes_insert_own on public.poll_votes for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists poll_reports_select_own on public.poll_reports;
drop policy if exists poll_reports_insert_own on public.poll_reports;
create policy poll_reports_select_own on public.poll_reports for select to authenticated using ((select auth.uid()) = user_id);
create policy poll_reports_insert_own on public.poll_reports for insert to authenticated with check ((select auth.uid()) = user_id);

-- 최소 권한: 비로그인(anon)은 테이블 직접 접근 불가, 로그인 사용자도 수정(UPDATE) 불가
revoke all on public.polls, public.poll_votes, public.poll_reports from anon, authenticated;
grant select (id, title, category, options, duration_hours, created_at, closes_at) on public.polls to authenticated;
grant insert (title, category, options, duration_hours) on public.polls to authenticated;
grant delete on public.polls to authenticated;
grant select (poll_id, option_index, created_at) on public.poll_votes to authenticated;
grant insert (poll_id, option_index) on public.poll_votes to authenticated;
grant select (poll_id, created_at) on public.poll_reports to authenticated;
grant insert (poll_id) on public.poll_reports to authenticated;

-- 공개 게시판: 합계만 돌려주는 읽기 전용 함수 (작성자·투표자 정보는 내보내지 않음)
create or replace function public.poll_board(p_limit integer default 60)
returns table (id uuid, title text, category text, options jsonb, created_at timestamptz, closes_at timestamptz,
               is_open boolean, counts integer[], total integer, mine boolean, my_vote smallint, reported boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.title, p.category, p.options, p.created_at, p.closes_at,
         p.closes_at > now() as is_open,
         array(select (select count(*) from public.poll_votes v where v.poll_id = p.id and v.option_index = i)::integer
               from generate_series(0, jsonb_array_length(p.options) - 1) i) as counts,
         (select count(*) from public.poll_votes v where v.poll_id = p.id)::integer as total,
         (p.user_id = auth.uid()) as mine,
         (select v.option_index from public.poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()) as my_vote,
         exists (select 1 from public.poll_reports r where r.poll_id = p.id and r.user_id = auth.uid()) as reported
    from public.polls p
   where (not p.hidden or p.user_id = auth.uid())
     and p.closes_at > now() - interval '30 days'
   order by (p.closes_at > now()) desc,
            case when p.closes_at > now() then p.closes_at end asc,
            p.closes_at desc
   limit least(greatest(coalesce(p_limit, 60), 1), 100)
$$;

-- 함수 실행 권한 정리: 게시판 읽기만 공개, 트리거·검사 함수는 직접 호출 불가
revoke execute on function public.poll_board(integer) from public;
grant execute on function public.poll_board(integer) to anon, authenticated;
revoke execute on function public.polls_before_insert(), public.poll_votes_before_insert(),
                       public.poll_reports_before_insert(), public.poll_reports_after_insert() from public, anon, authenticated;
