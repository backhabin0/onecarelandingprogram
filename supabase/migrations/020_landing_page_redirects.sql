-- 랜딩페이지 301 이동 목록: 옛 주소(/from_slug) → 새 주소(/to_slug)
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~019를 먼저 실행한 상태여야 한다)
-- 기존 migration(001~019)은 수정하지 않는다.
-- 되돌리기: supabase/rollback/020_down.sql
--
-- 중복·비슷한 페이지를 대표 페이지 하나로 합칠 때 쓴다. proxy가 이 목록을 읽어
-- /from_slug 요청을 /to_slug로 301 이동시키고, 옛 주소는 sitemap·홈·허브·내부 링크에서 빠진다.
-- 옛 페이지 행(landing_pages)은 지우지 않아도 된다(이동이 먼저 적용됨). 지워도 이동은 계속된다
-- (그래서 landing_pages에 외래 키를 걸지 않는다 — 옛 페이지를 지우면 이동까지 사라지면 안 됨).
--
-- 막는 것(트리거):
-- - 연쇄 이동: 새 주소가 이미 다른 곳으로 이동된 옛 주소이면 거절(A→B, B→C 금지)
--   옛 주소가 이미 다른 항목의 새 주소이면 거절(B→C가 있는데 A→B 추가 금지 — 반대 방향)
-- - 순환 이동: 위 두 규칙과 자기 자신 금지(check)로 A→B→A 같은 순환이 생길 수 없다
-- - 새 주소에 공개 중인 랜딩페이지가 없으면 거절
-- 동시에 두 항목을 넣어 규칙을 피하지 못하게 트리거 안에서 테이블을 잠근다.
--
-- 쓰기: 관리자 화면은 목록 확인만 한다. 추가·삭제는 SQL(운영 작업 승인 후)로 한다.
-- anon 읽기: proxy가 비로그인 방문 요청에서 목록을 읽어야 한다(옛 주소·새 주소만 들어 있는 공개 정보).

create table if not exists public.landing_page_redirects (
  from_slug text primary key,
  to_slug text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint landing_page_redirects_from_slug_format check (from_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint landing_page_redirects_to_slug_format check (to_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint landing_page_redirects_not_self check (from_slug <> to_slug),
  constraint landing_page_redirects_note_length check (char_length(note) <= 200)
);

create index if not exists landing_page_redirects_to_slug_idx
  on public.landing_page_redirects (to_slug);

create or replace function public.check_landing_page_redirect()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  lock table public.landing_page_redirects in share row exclusive mode;

  if exists (
    select 1 from public.landing_page_redirects r
     where r.from_slug = new.to_slug
       and (tg_op = 'INSERT' or r.from_slug <> old.from_slug)
  ) then
    raise exception '새 주소 "%"는 이미 다른 곳으로 이동된 옛 주소입니다(연쇄 이동 금지).', new.to_slug
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.landing_page_redirects r
     where r.to_slug = new.from_slug
       and (tg_op = 'INSERT' or r.from_slug <> old.from_slug)
  ) then
    raise exception '옛 주소 "%"로 이동하는 항목이 이미 있습니다(연쇄 이동 금지).', new.from_slug
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.landing_pages lp
     where lp.slug = new.to_slug and lp.status = 'public'
  ) then
    raise exception '새 주소 "%"에 공개 중인 랜딩페이지가 없습니다.', new.to_slug
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists landing_page_redirects_check on public.landing_page_redirects;
create trigger landing_page_redirects_check
  before insert or update on public.landing_page_redirects
  for each row execute function public.check_landing_page_redirect();

alter table public.landing_page_redirects enable row level security;

drop policy if exists "Anyone can select landing_page_redirects" on public.landing_page_redirects;
create policy "Anyone can select landing_page_redirects"
  on public.landing_page_redirects
  for select
  to anon, authenticated
  using (true);
