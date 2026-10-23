-- 대량 공개(bulk publish) 4단계: 엑셀 대량 등록의 문장 유사도 기준값
-- Supabase Dashboard > SQL Editor 에서 실행한다. (001~013을 먼저 실행한 상태여야 한다)
-- 기존 migration(001~013)은 수정하지 않는다.
-- 되돌리기: supabase/rollback/014_down.sql (자동 실행되지 않는 별도 폴더)
--
-- 대량 등록 시 대표 문구+소개 문구의 글자 3-gram Jaccard 유사도가
--   similarity_warning_threshold 이상이면 경고,
--   similarity_error_threshold 이상이면 오류(관리자가 선택하면 hold로 저장)
-- 로 처리한다. 관리자 설정 화면에서 바꿀 수 있도록 013의 단일 행 설정
-- 테이블(auto_publish_settings)에 컬럼으로 추가한다. 기본값을 주므로
-- 기존 'default' 행에도 바로 0.60 / 0.80이 들어간다.

alter table public.auto_publish_settings
  add column if not exists similarity_warning_threshold numeric(3, 2) not null default 0.60,
  add column if not exists similarity_error_threshold numeric(3, 2) not null default 0.80;

alter table public.auto_publish_settings
  drop constraint if exists auto_publish_settings_similarity_thresholds_check;
alter table public.auto_publish_settings
  add constraint auto_publish_settings_similarity_thresholds_check
  check (
    similarity_warning_threshold > 0
    and similarity_warning_threshold < similarity_error_threshold
    and similarity_error_threshold <= 1
  );

-- 참고: RLS 정책(013: authenticated만 조회/수정)은 그대로 적용된다.
