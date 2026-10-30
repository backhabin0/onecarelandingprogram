-- 020_landing_page_redirects.sql 되돌리기 (운영 적용이 실패했을 때만 수동으로 실행)
-- supabase/migrations 밖에 있어 자동으로 실행되지 않는다.
-- 주의: 이동 목록이 사라져 옛 주소가 다시 옛 페이지(또는 404)를 보여 준다.
-- 이 브랜치 코드는 테이블이 없으면 이동 없이 예전처럼 동작한다(목록을 못 읽으면 이동하지 않음).

begin;

drop table if exists public.landing_page_redirects;
drop function if exists public.check_landing_page_redirect();

commit;
