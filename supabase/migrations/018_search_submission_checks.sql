-- 공개 대기열 화면 '공개된 주소' 카드: 네이버 서치어드바이저 수집 요청을 마친 페이지 표시
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~017을 먼저 실행한 상태여야 한다)
-- 기존 migration(001~017)은 수정하지 않는다.
-- 되돌리기: supabase/rollback/018_down.sql
--
-- 관리자가 주소를 복사하거나 직접 체크하면 한 행이 생기고, 체크를 풀면 행을 지운다.
-- 브라우저가 아니라 DB에 두어서 다른 PC·브라우저에서도 같은 체크 상태가 보인다.
-- 페이지를 지우면 체크 기록도 함께 지운다(on delete cascade).

create table if not exists public.search_submission_checks (
  landing_page_id uuid primary key references public.landing_pages(id) on delete cascade,
  checked_at timestamptz not null default now(),
  -- 체크한 관리자(auth.users.id). 기록용이라 외래 키는 두지 않는다.
  checked_by uuid default auth.uid()
);

alter table public.search_submission_checks enable row level security;

-- 관리자(로그인한 authenticated 사용자)만 조회·추가·삭제. 수정은 쓰지 않으므로 정책을 두지 않는다.
-- anon(비로그인 방문자)에게는 정책이 없어 읽기·쓰기 모두 막힌다.
drop policy if exists "Authenticated can select search_submission_checks" on public.search_submission_checks;
create policy "Authenticated can select search_submission_checks"
  on public.search_submission_checks
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can insert search_submission_checks" on public.search_submission_checks;
create policy "Authenticated can insert search_submission_checks"
  on public.search_submission_checks
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated can delete search_submission_checks" on public.search_submission_checks;
create policy "Authenticated can delete search_submission_checks"
  on public.search_submission_checks
  for delete
  to authenticated
  using (true);
