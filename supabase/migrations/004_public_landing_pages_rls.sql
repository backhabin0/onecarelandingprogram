-- 5단계: 고객용 공개 랜딩페이지(/[slug])를 위한 anon SELECT 정책 추가
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~003을 먼저 실행한 상태여야 한다)

-- anon(비로그인) 사용자는 status = 'public'인 row만 조회할 수 있다.
-- private row는 조회할 수 없고, INSERT/UPDATE/DELETE 정책은 anon에게
-- 하나도 존재하지 않으므로 계속 거부된다.

drop policy if exists "Public can read public landing_pages" on public.landing_pages;
create policy "Public can read public landing_pages"
  on public.landing_pages
  for select
  to anon
  using (status = 'public');

-- 참고: authenticated 관리자의 기존 SELECT/INSERT/UPDATE/DELETE 정책
-- (002_auth_rls.sql, 003_landing_pages_crud_rls.sql)은 그대로 유지된다.
-- 이 migration은 anon 역할에 한정된 SELECT 정책만 추가한다.
