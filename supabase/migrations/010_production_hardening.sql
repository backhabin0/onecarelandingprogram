-- 17단계: Production 운영 안정화 — 상담 신청 중복 제출(idempotency) 방지
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~009를 먼저 실행한 상태여야 한다)
-- 기존 migration(001~009)은 절대 수정하지 않는다.

-- 클라이언트(ConsultationForm)가 폼 제출 1건마다 생성하는 고유 식별자
-- (crypto.randomUUID()). 네트워크 재시도/빠른 중복 클릭으로 동일 요청이 두 번
-- 도착해도 이 값의 UNIQUE 제약이 두 번째 INSERT를 거부해 같은 상담이 두 번
-- 저장되거나 이메일이 두 번 발송되지 않게 한다.
--
-- 기존 row에는 이 값이 없으므로 nullable로 추가한다. 부분 unique 인덱스
-- (submission_id is not null)를 사용해 여러 개의 NULL(기존 데이터 + 혹시
-- 값을 보내지 못한 요청)이 서로 충돌하지 않게 한다 — 기존 데이터에 대한
-- 백필/변환이 전혀 필요하지 않다. 새 상담 신청은 항상 애플리케이션 레벨
-- (app/[slug]/actions.ts)에서 값을 채워 보낸다.
alter table public.consultation_requests
  add column if not exists submission_id text;

create unique index if not exists consultation_requests_submission_id_key
  on public.consultation_requests (submission_id)
  where submission_id is not null;

-- 참고: 이 migration은 consultation_requests에 컬럼/인덱스 1개만 추가한다.
-- 기존 RLS 정책(006/007)은 submission_id를 참조하지 않으므로 그대로 유지되고,
-- landing_pages 등 다른 테이블의 스키마/정책도 전혀 건드리지 않는다.
