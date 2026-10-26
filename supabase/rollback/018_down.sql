-- 018_search_submission_checks.sql 되돌리기 (운영 적용이 실패했을 때만 수동으로 실행)
-- supabase/migrations 밖에 있어 자동으로 실행되지 않는다.
-- 주의: 수집 요청 완료 체크 기록이 사라진다. 이 브랜치 코드는 테이블이 없으면
-- 공개된 주소 목록을 체크 없이 보여 주고, 체크 저장만 실패한다(안내 문구 표시).

begin;

drop table if exists public.search_submission_checks;

commit;
