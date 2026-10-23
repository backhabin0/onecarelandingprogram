-- 013_publish_queue.sql 되돌리기 (운영 적용이 실패했을 때만 수동으로 실행)
--
-- 이 파일은 supabase/migrations 밖(supabase/rollback)에 두어 Supabase CLI의
-- `db push`/`migration up` 등이 자동으로 실행하지 않는다. 필요할 때만
-- Supabase Dashboard > SQL Editor 에 붙여 넣어 실행한다.
--
-- 주의: 아래를 실행하면 대기열·자동 공개 설정·실행 기록과
-- landing_pages.published_at 값이 모두 삭제된다(되살릴 수 없음).
-- 대기열에서 이미 공개된 랜딩페이지(landing_pages 행)와 그 SEO 설정·FAQ는
-- 지우지 않는다 — 공개된 페이지는 그대로 남고 published_at 정보만 사라진다.
-- 실행 전에 관리자 화면에서 백업 파일을 먼저 받아 둘 것.

begin;

drop function if exists public.publish_queued_landing_pages(integer);

drop table if exists public.publish_runs;
drop table if exists public.auto_publish_settings;
drop table if exists public.landing_page_queue;

drop function if exists public.is_valid_queue_faqs(jsonb);

alter table public.landing_pages
  drop column if exists published_at;

commit;
