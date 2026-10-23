-- 6단계: 매일 자동 공개 등록 (수동 실행 전용 — migration 폴더 밖이라 자동 실행되지 않음)
-- 먼저 supabase/migrations/015_auto_publish_indexnow.sql 이 적용되어 있어야 한다.
--
-- 적용 방법(운영 적용 단계에서, 사용자 지시 후):
--   1. Supabase Dashboard > Database > Extensions 에서 pg_cron 을 켠다
--      (또는 아래 create extension 줄이 권한 문제 없이 실행되는지 확인).
--   2. 이 파일의 [A] 부분을 SQL Editor 에서 실행한다.
--   3. Database > Cron(또는 select * from cron.job) 에서 'onecare-daily-auto-publish' 가
--      '0 0 * * *'(매일 00:00 UTC = 09:00 KST)로 등록됐는지 확인한다.
--   4. 관리자 설정 화면에서 "자동 공개"를 켜야 실제로 공개된다(기본 꺼짐).
--
-- pg_cron 은 UTC 기준으로 동작한다. 00:00 UTC = 한국 시간 09:00.
-- 공개 함수의 "하루 1회" 판단은 한국 날짜 기준이라, 09:00 KST 실행은 그날 날짜로 기록된다.

-- ============================================================
-- [A] 매일 자동 공개 등록
-- ============================================================
create extension if not exists pg_cron;

-- 같은 이름이 이미 있으면 지우고 다시 등록한다(여러 번 실행해도 안전).
select cron.unschedule(jobid)
from cron.job
where jobname = 'onecare-daily-auto-publish';

select cron.schedule(
  'onecare-daily-auto-publish',
  '0 0 * * *',
  $$select public.run_auto_publish(false)$$
);

-- ============================================================
-- [B] (선택) IndexNow 예약 호출용 비밀값 등록
-- ============================================================
-- /api/indexnow 를 로그인 없이(예: Vercel Cron) 부를 때, 서버가 DB에 넘기는
-- CRON_SECRET 값을 Supabase Vault 에 같은 값으로 저장해 둔다. 16자 이상 무작위 값.
-- 'CRON_SECRET과_같은_값' 을 실제 값으로 바꿔 한 번만 실행한다(값을 git에 넣지 말 것).
--
-- select vault.create_secret('CRON_SECRET과_같은_값', 'indexnow_cron_secret', 'IndexNow 예약 호출 확인용');
--
-- 값을 바꿀 때:
-- select vault.update_secret(
--   (select id from vault.secrets where name = 'indexnow_cron_secret'),
--   '새_값'
-- );

-- ============================================================
-- [C] 등록 해제(자동 공개를 완전히 멈출 때)
-- ============================================================
-- select cron.unschedule(jobid) from cron.job where jobname = 'onecare-daily-auto-publish';
--
-- 참고: 일시적으로 멈출 때는 등록 해제 대신 관리자 설정 화면에서 "자동 공개"를 끄면 된다
-- (pg_cron 은 계속 돌지만 run_auto_publish 가 꺼짐을 보고 아무것도 하지 않는다).
