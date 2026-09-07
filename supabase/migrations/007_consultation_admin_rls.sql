-- 9단계: 관리자(로그인한 authenticated 사용자)의 상담 데이터 SELECT/UPDATE 허용
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~006을 먼저 실행한 상태여야 한다)
-- 006 migration은 수정하지 않는다.

-- 참고: 006에서 만든 anon/authenticated INSERT 정책은 그대로 유지된다.
-- 이 migration은 authenticated 대상 SELECT/UPDATE 정책만 추가한다.
-- "로그인한 사용자 = 관리자"로 간주하는 기존 프로젝트 방침(landing_pages와 동일)을 따른다.

drop policy if exists "Authenticated can select consultation_requests" on public.consultation_requests;
create policy "Authenticated can select consultation_requests"
  on public.consultation_requests
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can update consultation_requests" on public.consultation_requests;
create policy "Authenticated can update consultation_requests"
  on public.consultation_requests
  for update
  to authenticated
  using (true)
  with check (true);

-- DELETE 정책은 의도적으로 추가하지 않는다. 상담 신청 기록은 삭제 기능 없이
-- 보존한다는 것이 9단계의 방침이다. anon은 여전히 SELECT/UPDATE/DELETE가
-- 모두 거부되고 INSERT만 가능하다(006 정책 유지, 이 migration에서 변경 없음).
