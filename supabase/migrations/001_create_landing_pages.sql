-- 2단계: landing_pages 테이블 생성
-- Supabase Dashboard > SQL Editor 에서 그대로 실행할 수 있다.

create extension if not exists "pgcrypto";

create table if not exists public.landing_pages (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  title text not null,
  slug text not null unique,
  hero_text text,
  description text,
  phone text,
  kakao_url text,
  address text,
  logo_url text,
  main_image_url text,
  template text not null default 'template-a',
  status text not null default 'private' check (status in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists landing_pages_created_at_idx
  on public.landing_pages (created_at desc);

-- updated_at 자동 갱신 트리거
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists landing_pages_set_updated_at on public.landing_pages;

create trigger landing_pages_set_updated_at
  before update on public.landing_pages
  for each row
  execute function public.set_updated_at();

-- Row Level Security
alter table public.landing_pages enable row level security;

-- TODO(3단계): 관리자 인증(Supabase Auth)이 추가되면 아래 "Dev: ..." 정책을
-- 제거하고, 인증된 관리자만 읽기/쓰기가 가능하도록 정책을 강화한다.
-- 예: using (auth.role() = 'authenticated') 또는 관리자 테이블 기반 검사.
-- 지금은 인증 시스템이 없으므로 개발/테스트를 위해 anon key로도
-- 읽기/쓰기가 가능한 최소한의 임시 정책만 둔다. (Service Role Key는 절대
-- 클라이언트에 노출하지 않는다.)

drop policy if exists "Dev: public can read landing_pages" on public.landing_pages;
create policy "Dev: public can read landing_pages"
  on public.landing_pages
  for select
  using (true);

drop policy if exists "Dev: public can insert landing_pages" on public.landing_pages;
create policy "Dev: public can insert landing_pages"
  on public.landing_pages
  for insert
  with check (true);
