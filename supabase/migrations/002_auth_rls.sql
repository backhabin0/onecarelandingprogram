-- 3단계: 인증 기반 RLS 정책으로 전환
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001을 먼저 실행한 상태여야 한다)

-- 2단계에서 만든 개발용 임시 정책 제거 (anon 사용자도 읽기/쓰기가 가능했다)
drop policy if exists "Dev: public can read landing_pages" on public.landing_pages;
drop policy if exists "Dev: public can insert landing_pages" on public.landing_pages;

-- TODO(향후 단계): 여러 관리자 권한(role)을 구분해야 한다면
-- profiles/admin_users 같은 테이블을 만들고 auth.uid() 기반으로
-- 세분화된 정책을 추가한다. 지금은 관리자 역할 테이블이 없으므로
-- "Supabase Auth로 로그인한 사용자 = 관리자"로 간주한다.

drop policy if exists "Authenticated can read landing_pages" on public.landing_pages;
create policy "Authenticated can read landing_pages"
  on public.landing_pages
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can insert landing_pages" on public.landing_pages;
create policy "Authenticated can insert landing_pages"
  on public.landing_pages
  for insert
  to authenticated
  with check (true);

-- 참고: update/delete 정책은 아직 만들지 않는다 — 수정/삭제 기능은
-- 다음 단계에서 구현하며, 그때 이 파일과 같은 방식(to authenticated)으로 추가한다.
