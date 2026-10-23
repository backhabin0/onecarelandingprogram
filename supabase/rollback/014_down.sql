-- 014_bulk_upload_similarity_settings.sql 되돌리기 (운영 적용이 실패했을 때만 수동으로 실행)
-- supabase/migrations 밖에 있어 자동으로 실행되지 않는다.
-- 013까지 되돌릴 때는 이 파일을 먼저 실행한 뒤 013_down.sql을 실행한다.
-- 주의: 설정 화면에서 바꾼 유사도 기준값이 사라진다.

begin;

alter table public.auto_publish_settings
  drop constraint if exists auto_publish_settings_similarity_thresholds_check;

alter table public.auto_publish_settings
  drop column if exists similarity_error_threshold,
  drop column if exists similarity_warning_threshold;

commit;
