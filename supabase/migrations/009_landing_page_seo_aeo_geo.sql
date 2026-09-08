-- 12.5단계: 랜딩페이지 SEO / AEO / GEO 자동+수동 설정을 위한 테이블 생성
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~008을 먼저 실행한 상태여야 한다)
-- 기존 migration(001~008)은 수정하지 않는다.
--
-- landing_pages 테이블 자체에는 컬럼을 추가하지 않고, 1:1 설정 테이블
-- (landing_page_seo_settings)과 1:N FAQ 테이블(landing_page_faqs)을 새로 만든다.
-- 두 테이블 모두 row가 없어도 애플리케이션이 자동 SEO/자동 FAQ로 정상 동작해야
-- 하므로, 기존 랜딩페이지에 대해 이 migration 실행 후 별도의 데이터 백필은
-- 필요하지 않다.

create extension if not exists "pgcrypto";

-- ============================================================
-- landing_page_seo_settings: 페이지별 수동 SEO/AEO/GEO 설정 (1:1)
-- ============================================================

create table if not exists public.landing_page_seo_settings (
  landing_page_id uuid primary key
    references public.landing_pages(id) on delete cascade,

  -- 비어있으면(null) resolver가 기존 자동 SEO 규칙(lib/seo.ts)을 사용한다.
  seo_title text check (char_length(seo_title) <= 120),
  seo_description text check (char_length(seo_description) <= 320),
  og_title text check (char_length(og_title) <= 120),
  og_description text check (char_length(og_description) <= 320),
  og_image_url text,

  -- true면 metadata robots에 noindex를 적용하고 sitemap에서 제외한다.
  -- 페이지 자체는 계속 정상 접근 가능하다(비공개가 아님).
  seo_noindex boolean not null default false,

  -- 구조화 데이터(Organization/LocalBusiness)와 공개 업체 정보에 사용하는
  -- 선택 입력값. 값이 없으면 관련 필드를 생략한다(추측/생성 금지).
  business_category text check (char_length(business_category) <= 100),
  service_area text check (char_length(service_area) <= 200),

  -- true면 자동 생성 FAQ를 숨기고 수동 FAQ만 사용한다.
  disable_auto_faq boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists landing_page_seo_settings_set_updated_at
  on public.landing_page_seo_settings;

create trigger landing_page_seo_settings_set_updated_at
  before update on public.landing_page_seo_settings
  for each row
  execute function public.set_updated_at();

alter table public.landing_page_seo_settings enable row level security;

-- 관리자(authenticated)는 모든 SEO 설정을 자유롭게 관리할 수 있다.
drop policy if exists "Authenticated can manage landing_page_seo_settings"
  on public.landing_page_seo_settings;
create policy "Authenticated can manage landing_page_seo_settings"
  on public.landing_page_seo_settings
  for all
  to authenticated
  using (true)
  with check (true);

-- anon(비로그인 고객)은 부모 랜딩페이지가 public인 경우에만 SEO 설정을
-- 읽을 수 있다. anon INSERT/UPDATE/DELETE 정책은 만들지 않으므로 계속 거부된다.
drop policy if exists "Public can read seo settings of public landing_pages"
  on public.landing_page_seo_settings;
create policy "Public can read seo settings of public landing_pages"
  on public.landing_page_seo_settings
  for select
  to anon
  using (
    exists (
      select 1
      from public.landing_pages lp
      where lp.id = landing_page_id
        and lp.status = 'public'
    )
  );

-- ============================================================
-- landing_page_faqs: 페이지별 수동 FAQ (1:N)
-- ============================================================

create table if not exists public.landing_page_faqs (
  id uuid primary key default gen_random_uuid(),
  landing_page_id uuid not null
    references public.landing_pages(id) on delete cascade,

  question text not null check (char_length(question) <= 200),
  answer text not null check (char_length(answer) <= 2000),

  sort_order integer not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists landing_page_faqs_landing_page_sort_idx
  on public.landing_page_faqs (landing_page_id, sort_order);

drop trigger if exists landing_page_faqs_set_updated_at
  on public.landing_page_faqs;

create trigger landing_page_faqs_set_updated_at
  before update on public.landing_page_faqs
  for each row
  execute function public.set_updated_at();

alter table public.landing_page_faqs enable row level security;

-- 관리자(authenticated)는 모든 FAQ(비활성 포함)를 자유롭게 관리할 수 있다.
drop policy if exists "Authenticated can manage landing_page_faqs"
  on public.landing_page_faqs;
create policy "Authenticated can manage landing_page_faqs"
  on public.landing_page_faqs
  for all
  to authenticated
  using (true)
  with check (true);

-- anon(비로그인 고객)은 부모 랜딩페이지가 public이고, 해당 FAQ가
-- is_active = true인 경우에만 읽을 수 있다. anon INSERT/UPDATE/DELETE
-- 정책은 만들지 않으므로 계속 거부된다.
drop policy if exists "Public can read active faqs of public landing_pages"
  on public.landing_page_faqs;
create policy "Public can read active faqs of public landing_pages"
  on public.landing_page_faqs
  for select
  to anon
  using (
    is_active = true
    and exists (
      select 1
      from public.landing_pages lp
      where lp.id = landing_page_id
        and lp.status = 'public'
    )
  );

-- 참고: 이 migration은 landing_page_seo_settings, landing_page_faqs 두
-- 테이블에만 정책을 추가한다. landing_pages, consultation_requests,
-- landing_page_events 등 기존 테이블의 RLS는 그대로 유지된다.
