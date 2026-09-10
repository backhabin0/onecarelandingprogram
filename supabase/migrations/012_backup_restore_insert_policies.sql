-- 18단계: 백업 파일로 상담/Analytics 이벤트를 복구(merge restore)할 수 있도록
-- 관리자(authenticated) 전용 INSERT 정책을 추가한다.
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~011을 먼저 실행한 상태여야 한다)
-- 기존 migration(001~011)은 수정하지 않는다.
--
-- 006/008에서 만든 "Public can insert ..." 정책(anon, authenticated 공용)은
--   - consultation_requests: status = 'new', privacy_consent = true,
--     landing_page_id가 실제 status='public'인 랜딩페이지를 가리켜야 함
--   - landing_page_events: event_type이 허용값 중 하나, landing_page_id가
--     실제 status='public'인 랜딩페이지를 가리켜야 함
-- 을 강제한다. 고객이 실제 신청 폼/이벤트 트래킹으로 들어오는 정상 경로에는
-- 맞지만, 관리자가 과거 백업 파일을 복구할 때는 상태가 'contacted'/
-- 'completed'이거나 부모 랜딩페이지가 이후 비공개로 바뀐 row가 있을 수 있어
-- 이 제약에 막힌다.
--
-- 관리자(authenticated)에게만 조건 없는 INSERT를 별도 정책으로 허용해 이
-- 문제를 해결한다. "로그인한 사용자 = 관리자"로 간주하는 기존 프로젝트
-- 방침을 그대로 따른다. 기존 anon 정책/제약은 전혀 변경하지 않는다 —
-- 비로그인 고객은 여전히 status='new' + public landing_page 조건을 100%
-- 강제받는다. SELECT/UPDATE 정책(007/008)도 그대로 유지된다.

drop policy if exists "Authenticated can insert consultation_requests (restore)"
  on public.consultation_requests;
create policy "Authenticated can insert consultation_requests (restore)"
  on public.consultation_requests
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated can insert landing_page_events (restore)"
  on public.landing_page_events;
create policy "Authenticated can insert landing_page_events (restore)"
  on public.landing_page_events
  for insert
  to authenticated
  with check (true);

-- 참고: 이 migration은 두 테이블에 authenticated 대상 INSERT 정책만
-- 추가한다. 새 테이블/컬럼/함수(RPC)는 만들지 않는다.
