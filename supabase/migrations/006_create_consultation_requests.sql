-- 8단계: 상담/CTA 신청 데이터 저장을 위한 consultation_requests 테이블 생성
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~005를 먼저 실행한 상태여야 한다)
-- 기존 landing_pages 관련 migration(001~005)은 수정하지 않는다.

create extension if not exists "pgcrypto";

create table if not exists public.consultation_requests (
  id uuid primary key default gen_random_uuid(),
  -- 랜딩페이지가 삭제되더라도 상담 신청 기록(운영 데이터)은 보존해야 하므로
  -- nullable + on delete set null로 설계한다. cascade delete는 사용하지 않는다.
  landing_page_id uuid references public.landing_pages(id) on delete set null,
  name text not null,
  phone text not null,
  message text,
  privacy_consent boolean not null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists consultation_requests_landing_page_id_idx
  on public.consultation_requests (landing_page_id);

create index if not exists consultation_requests_created_at_idx
  on public.consultation_requests (created_at desc);

-- Row Level Security
alter table public.consultation_requests enable row level security;

-- anon(비로그인 고객) 및 authenticated(로그인 상태에서 공개 페이지를 열람 중인
-- 관리자 포함)은 상담 신청 INSERT만 가능하다. SELECT/UPDATE/DELETE 정책은
-- 이 migration에서 하나도 만들지 않으므로 기본적으로 모두 거부된다.
-- (9단계 상담 관리 기능에서 authenticated 전용 SELECT/UPDATE 정책을 추가한다)
--
-- with check에 다음 조건을 모두 강제해 애플리케이션 검증이 우회되더라도
-- DB 레벨에서 한 번 더 막는다:
--   1) status는 반드시 'new'로만 최초 접수된다.
--   2) privacy_consent는 반드시 true여야 한다.
--   3) landing_page_id는 실제로 존재하고 status = 'public'인 랜딩페이지여야 한다.
drop policy if exists "Public can insert consultation_requests" on public.consultation_requests;
create policy "Public can insert consultation_requests"
  on public.consultation_requests
  for insert
  to anon, authenticated
  with check (
    status = 'new'
    and privacy_consent = true
    and exists (
      select 1
      from public.landing_pages lp
      where lp.id = landing_page_id
        and lp.status = 'public'
    )
  );

-- 참고: 이 migration은 consultation_requests 테이블에만 정책을 추가한다.
-- landing_pages를 비롯한 다른 테이블의 기존 RLS 정책은 그대로 유지된다.
