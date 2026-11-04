-- 결정국 데이터베이스 설정 (Supabase SQL Editor에 전체를 붙여 넣고 Run)
-- 원칙: 로그인한 사용자는 "자기 기록"만 조회·추가·삭제할 수 있다. 수정(UPDATE)은 허용하지 않는다.

-- 1) 판결 기록 테이블
create table if not exists public.decisions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 100),
  category    text not null check (category in ('여행', '맛집', '쇼핑', '연애', '게임', '일상')),
  detail      text not null default '' check (char_length(detail) <= 1000),
  options     jsonb not null check (jsonb_typeof(options) = 'array'
                                    and jsonb_array_length(options) between 2 and 6
                                    and octet_length(options::text) <= 2000),
  priority    text not null check (priority in ('cost', 'fun', 'safe', 'easy')),
  price       integer check (price between 1 and 100000000),
  budget      integer check (budget between 1 and 100000000),
  verdict     text not null check (char_length(verdict) between 1 and 120),
  label       text check (char_length(label) <= 30),
  tally       text check (char_length(tally) <= 400),
  opinions    jsonb not null default '[]' check (jsonb_typeof(opinions) = 'array'
                                                 and octet_length(opinions::text) <= 6000),
  retrial     boolean not null default false,
  created_at  timestamptz not null default now(),
  -- 쇼핑이면 가격·예산이 반드시 있어야 하고, 쇼핑이 아니면 비어 있어야 한다
  constraint shop_money check (
    (category = '쇼핑' and price is not null and budget is not null)
    or (category <> '쇼핑' and price is null and budget is null)
  )
);

create index if not exists decisions_user_created_idx on public.decisions (user_id, created_at desc);

-- 2) 행 단위 접근 제어(RLS): 자기 기록만
alter table public.decisions enable row level security;

drop policy if exists "decisions_select_own" on public.decisions;
drop policy if exists "decisions_insert_own" on public.decisions;
drop policy if exists "decisions_delete_own" on public.decisions;

create policy "decisions_select_own" on public.decisions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "decisions_insert_own" on public.decisions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "decisions_delete_own" on public.decisions
  for delete to authenticated using ((select auth.uid()) = user_id);
-- UPDATE 정책은 만들지 않는다(판결 기록은 수정 불가). 권한도 회수한다.
-- 기본으로 붙는 권한(TRUNCATE·TRIGGER·REFERENCES 등)까지 모두 회수한 뒤 필요한 것만 준다(최소 권한).
revoke all on public.decisions from anon, authenticated;
grant select, insert, delete on public.decisions to authenticated;

-- 3) 내 캐릭터(프로필) 테이블: 자기 것만 조회·추가·수정
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  avatar     text check (avatar in ('grandpa', 'grandma', 'man30', 'woman30', 'teen_boy',
                                    'teen_girl', 'student', 'skater', 'woman40', 'man50')),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

-- 4) 확인용: 아래 결과에서 두 테이블 모두 rowsecurity = true 여야 한다
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('decisions', 'profiles');
