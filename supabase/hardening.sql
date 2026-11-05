-- 보안 점검(Supabase Security Advisor) 후 적용한 최소 권한 조치 — 2026-11-05 적용 완료
-- rls_auto_enable()은 "Enable automatic RLS" 설정이 만든 이벤트 트리거 함수(SECURITY DEFINER)로,
-- 기본값으로는 비로그인(anon)·로그인 사용자도 /rest/v1/rpc 로 호출할 수 있게 열려 있었다.
-- 사용자가 직접 부를 이유가 없으므로 실행 권한을 회수한다. (트리거 동작에는 영향 없음)
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 참고: delete_my_account()도 SECURITY DEFINER 경고가 나오지만, 회원 탈퇴용으로 로그인 사용자(authenticated)만
-- 실행하도록 의도한 함수다. 함수 안에서 auth.uid()로 본인만 지우므로 다른 사람 데이터에는 영향이 없다.
