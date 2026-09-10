-- 17.5단계: 관리자 화면에서 관리하는 검색엔진(Google/Naver) 소유확인 설정
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~010을 먼저 실행한 상태여야 한다)
-- 기존 migration(001~010)은 수정하지 않는다.
--
-- onecarepage.co.kr 도메인 전체에 대한 단일(singleton) 설정이다.
-- 랜딩페이지별 설정이 아니므로 landing_pages / landing_page_seo_settings에는
-- 컬럼을 추가하지 않는다.

create table if not exists public.site_verification_settings (
  -- 항상 'default' 한 row만 사용한다(멀티 row UI를 만들지 않는다).
  id text primary key,

  -- 비어있으면(null) 애플리케이션이 기존 환경변수
  -- (GOOGLE_SITE_VERIFICATION / NAVER_SITE_VERIFICATION)로 대체한다.
  google_site_verification text check (char_length(google_site_verification) <= 500),
  naver_site_verification text check (char_length(naver_site_verification) <= 500),

  updated_at timestamptz not null default now()
);

-- 기본 singleton row를 안전하게 보장한다(이미 있으면 아무 것도 하지 않음).
insert into public.site_verification_settings (id)
values ('default')
on conflict (id) do nothing;

alter table public.site_verification_settings enable row level security;

-- 관리자(로그인한 authenticated 사용자)는 조회/수정 가능.
-- "로그인한 사용자 = 관리자"로 간주하는 기존 프로젝트 방침(landing_pages와 동일)을 따른다.
drop policy if exists "Authenticated can select site_verification_settings" on public.site_verification_settings;
create policy "Authenticated can select site_verification_settings"
  on public.site_verification_settings
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can update site_verification_settings" on public.site_verification_settings;
create policy "Authenticated can update site_verification_settings"
  on public.site_verification_settings
  for update
  to authenticated
  using (id = 'default')
  with check (id = 'default');

-- verification 값은 최종적으로 공개 HTML <head>의 meta 태그로 노출되는
-- 비밀 아닌 값이다. 비로그인 방문자에게 서비스되는 공개 페이지(/login, /[slug],
-- 루트 레이아웃)도 Redeploy 없이 즉시 이 값을 반영해야 하므로, 'default' row에
-- 한정해 anon SELECT도 허용한다. INSERT/UPDATE/DELETE는 anon에게 허용하지 않는다.
drop policy if exists "Public can read site_verification_settings" on public.site_verification_settings;
create policy "Public can read site_verification_settings"
  on public.site_verification_settings
  for select
  to anon
  using (id = 'default');

-- 참고: 이 migration은 새 테이블 1개(+ RLS 정책)만 추가한다.
-- landing_pages 등 기존 테이블의 스키마/정책은 전혀 건드리지 않는다.
