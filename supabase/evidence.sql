-- 판결 근거(실시간 정보 출처·조회 시각·표 조정 기록)를 저장할 칸 추가 (SQL Editor에서 한 번 실행)
alter table public.decisions
  add column if not exists evidence jsonb
  check (evidence is null or (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 4000));

-- 확인: evidence 칸이 보이면 성공
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'decisions' and column_name = 'evidence';
