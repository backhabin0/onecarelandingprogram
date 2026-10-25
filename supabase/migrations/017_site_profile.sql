-- SEO·AEO·GEO: 공개 홈(/)과 /llms.txt에 쓰는 사이트 대표 업체 정보
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~016을 먼저 실행한 상태여야 한다)
-- 기존 migration(001~016)은 수정하지 않는다.
-- 되돌리기: supabase/rollback/017_down.sql
--
-- 이 사이트에는 여러 업체의 랜딩페이지가 섞여 있고, landing_pages.business_name에는
-- 제목형 문구가 들어 있는 경우가 많아서 "사이트를 대표하는 업체"를 DB에서 추측할 수 없다.
-- 그래서 관리자가 직접 입력한 값만 쓴다. 비어 있으면(null) 홈·llms.txt는 업체 소개와
-- 연락처 없이 서비스·지역 링크만 보여 준다.

create table if not exists public.site_profile (
  -- 항상 'default' 한 행만 쓴다(site_verification_settings와 같은 방식).
  id text primary key check (id = 'default'),
  business_name text check (char_length(business_name) <= 100),
  -- 업체 한 줄 소개(홈 설명·meta description·llms.txt 요약)
  description text check (char_length(description) <= 320),
  phone text check (char_length(phone) <= 30),
  kakao_url text check (char_length(kakao_url) <= 500),
  updated_at timestamptz not null default now()
);

insert into public.site_profile (id)
values ('default')
on conflict (id) do nothing;

alter table public.site_profile enable row level security;

-- 관리자(로그인한 authenticated 사용자)는 조회·수정만. 행 추가·삭제 정책은 두지 않는다.
drop policy if exists "Authenticated can select site_profile" on public.site_profile;
create policy "Authenticated can select site_profile"
  on public.site_profile
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can update site_profile" on public.site_profile;
create policy "Authenticated can update site_profile"
  on public.site_profile
  for update
  to authenticated
  using (id = 'default')
  with check (id = 'default');

-- 공개 홈·llms.txt에 그대로 보이는 값이라 비로그인 방문자(anon)도 읽을 수 있어야 한다.
-- 쓰기(insert/update/delete)는 anon에게 허용하지 않는다.
drop policy if exists "Public can read site_profile" on public.site_profile;
create policy "Public can read site_profile"
  on public.site_profile
  for select
  to anon
  using (id = 'default');
