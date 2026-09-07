-- 10단계: 랜딩페이지 통계(조회수/전화 클릭/카카오 클릭)를 위한 이벤트 테이블 생성
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~007을 먼저 실행한 상태여야 한다)
-- 기존 migration(001~007)은 수정하지 않는다.
--
-- 상담 신청 수는 이 테이블에 중복 저장하지 않는다. 기존 consultation_requests
-- row 수를 그대로 상담 신청 수로 집계한다(9단계 lib/consultation-requests.ts 참고).

create extension if not exists "pgcrypto";

create table if not exists public.landing_page_events (
  id uuid primary key default gen_random_uuid(),
  -- 랜딩페이지가 삭제되더라도 과거 통계 데이터는 보존해야 하므로
  -- consultation_requests와 동일하게 nullable + on delete set null로 설계한다.
  landing_page_id uuid references public.landing_pages(id) on delete set null,
  event_type text not null
    check (event_type in ('page_view', 'phone_click', 'kakao_click')),
  created_at timestamptz not null default now()
);

-- 개인정보(이름/연락처/IP/문의내용/식별정보)는 절대 저장하지 않는다.
-- 이 테이블은 landing_page_id, event_type, created_at 세 컬럼만 가진다.

create index if not exists landing_page_events_landing_page_created_at_idx
  on public.landing_page_events (landing_page_id, created_at);

create index if not exists landing_page_events_type_created_at_idx
  on public.landing_page_events (event_type, created_at);

-- Row Level Security
alter table public.landing_page_events enable row level security;

-- anon(비로그인 고객) 및 authenticated(로그인 상태에서 공개 페이지를 열람 중인
-- 관리자 포함)는 이벤트 INSERT만 가능하다. SELECT/UPDATE/DELETE 정책은 이
-- migration에서 만들지 않으므로 anon은 기본적으로 모두 거부된다.
--
-- with check로 다음을 DB 레벨에서도 강제한다(애플리케이션 검증 우회 방지):
--   1) event_type은 page_view/phone_click/kakao_click 3개 값만 허용(컬럼 CHECK와 이중 방어).
--   2) landing_page_id는 실제로 존재하고 status = 'public'인 랜딩페이지여야 한다.
drop policy if exists "Public can insert landing_page_events" on public.landing_page_events;
create policy "Public can insert landing_page_events"
  on public.landing_page_events
  for insert
  to anon, authenticated
  with check (
    event_type in ('page_view', 'phone_click', 'kakao_click')
    and exists (
      select 1
      from public.landing_pages lp
      where lp.id = landing_page_id
        and lp.status = 'public'
    )
  );

-- 관리자(authenticated)는 통계 조회를 위해 SELECT만 가능하다.
-- 이벤트는 생성 후 수정할 필요가 없으므로 UPDATE/DELETE 정책은 추가하지 않는다.
drop policy if exists "Authenticated can select landing_page_events" on public.landing_page_events;
create policy "Authenticated can select landing_page_events"
  on public.landing_page_events
  for select
  to authenticated
  using (true);

-- 참고: 이 migration은 landing_page_events 테이블에만 정책을 추가한다.
-- landing_pages, consultation_requests 등 기존 테이블의 RLS는 그대로 유지된다.
