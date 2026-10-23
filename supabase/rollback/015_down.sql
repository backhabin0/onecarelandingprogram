-- 015_auto_publish_indexnow.sql 되돌리기 (운영 적용이 실패했을 때만 수동으로 실행)
-- supabase/migrations 밖에 있어 자동으로 실행되지 않는다.
-- 매일 자동 공개를 등록했다면 먼저 supabase/manual/015_cron_schedule.sql 의
-- "등록 해제" 부분을 실행한다. 014까지 되돌릴 때는 이 파일 → 014_down → 013_down 순서.
-- 주의: IndexNow 전송 기록과 실행 기록의 trigger 값이 사라진다.

begin;

drop function if exists public.indexnow_record_submission(text, uuid[], boolean, integer, text, text);
drop function if exists public.indexnow_pending_pages(text, integer);
drop function if exists public.indexnow_caller_allowed(text);
drop table if exists public.indexnow_submissions;
drop table if exists public.indexnow_page_status;

drop function if exists public.run_auto_publish(boolean);

alter table public.publish_runs drop column if exists trigger;

-- 하루 개수 제약을 013 상태(1~1000)로 되돌린다.
alter table public.auto_publish_settings
  drop constraint if exists auto_publish_settings_daily_limit_check;
alter table public.auto_publish_settings
  add constraint auto_publish_settings_daily_limit_check
  check (daily_limit >= 1 and daily_limit <= 1000);

commit;
