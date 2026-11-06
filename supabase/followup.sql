-- =====================================================================
-- 판결 이후 기록: "실제로 했나요? / 만족도 1~5점" (2026-11-06 적용)
-- 설계
--  * 판결 결과(verdict·tally·opinions 등)는 여전히 수정 불가.
--  * 로그인 사용자는 '자기 기록'의 did_it, satisfaction 두 칸만 수정할 수 있다
--    (칸 단위 UPDATE 권한 + RLS UPDATE 정책).
--  * 기록 시각(followed_at)은 화면이 보낸 값을 믿지 않고 DB 트리거가 서버 시각으로 채운다.
--  * 선택 사항이라 비워 둬도 판결 이용에는 영향이 없다.
-- =====================================================================
alter table public.decisions
  add column if not exists did_it boolean,
  add column if not exists satisfaction smallint check (satisfaction is null or satisfaction between 1 and 5),
  add column if not exists followed_at timestamptz;

create or replace function public.decisions_followup_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.followed_at := case when new.did_it is null and new.satisfaction is null then null else now() end;
  return new;
end $$;
drop trigger if exists decisions_followup_stamp on public.decisions;
create trigger decisions_followup_stamp before update of did_it, satisfaction on public.decisions
  for each row execute function public.decisions_followup_stamp();
revoke execute on function public.decisions_followup_stamp() from public, anon, authenticated;

drop policy if exists decisions_update_followup_own on public.decisions;
create policy decisions_update_followup_own on public.decisions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 칸 단위 권한: 이 두 칸 말고는 UPDATE 권한이 없다
grant update (did_it, satisfaction) on public.decisions to authenticated;
grant select (did_it, satisfaction, followed_at) on public.decisions to authenticated;
