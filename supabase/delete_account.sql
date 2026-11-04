-- 회원 탈퇴: 로그인한 본인 계정만 삭제한다. (Supabase SQL Editor에서 한 번 실행)
-- security definer로 auth.users 삭제 권한을 빌리되, 대상은 항상 auth.uid() 본인으로 고정한다.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.decisions where user_id = me;
  delete from public.profiles  where user_id = me;
  delete from auth.users       where id = me;
end;
$$;

-- 비로그인(anon)과 모든 사용자(public)에게서 실행 권한을 빼고, 로그인 사용자에게만 준다.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 확인: authenticated만 EXECUTE 권한이 있어야 한다
select grantee, privilege_type from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'delete_my_account';
