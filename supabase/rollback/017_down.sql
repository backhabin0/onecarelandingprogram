-- 017_site_profile.sql 되돌리기 (운영 적용이 실패했을 때만 수동으로 실행)
-- supabase/migrations 밖에 있어 자동으로 실행되지 않는다.
-- 주의: 관리자가 입력한 사이트 대표 업체 정보가 사라진다. 이 브랜치 코드는 테이블이 없으면
-- 홈·llms.txt에서 업체 정보 없이 동작한다(조회 실패를 빈 값으로 처리).

begin;

drop table if exists public.site_profile;

commit;
