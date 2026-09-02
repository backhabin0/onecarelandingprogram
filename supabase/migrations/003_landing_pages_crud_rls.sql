-- 4단계: 랜딩페이지 수정/삭제를 위한 UPDATE/DELETE RLS 정책 추가
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001, 002를 먼저 실행한 상태여야 한다)

-- 참고: 002에서 SELECT/INSERT는 이미 authenticated 전용으로 전환했다.
-- 여기서는 부족했던 UPDATE/DELETE 정책만 추가한다.
-- "Supabase Auth로 로그인한 사용자 = 관리자"로 간주하는 기존 방침을 그대로 따른다.

drop policy if exists "Authenticated can update landing_pages" on public.landing_pages;
create policy "Authenticated can update landing_pages"
  on public.landing_pages
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated can delete landing_pages" on public.landing_pages;
create policy "Authenticated can delete landing_pages"
  on public.landing_pages
  for delete
  to authenticated
  using (true);

-- anon 사용자는 이 테이블에 대한 어떤 정책에도 해당하지 않으므로
-- SELECT/INSERT/UPDATE/DELETE 모두 계속 거부된다.
