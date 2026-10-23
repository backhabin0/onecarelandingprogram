# 대량 등록·자동 공개(bulk publish) 전체 계획

브랜치: `feature/bulk-publish` (기준: `main` 4ddf124)
세부 진행 기록과 검증 결과는 저장소 루트의 `HANDOFF.md`에 있다.

**원칙**
- 운영 DB(`jxatzdldyawjxgeepdiz`)와 다른 Supabase 프로젝트에는 접속하지 않는다. 운영 적용은 8단계에서 사용자 지시 후에만 한다.
- 검증은 모의 클라이언트(`tests/helpers/fake-supabase.ts`)와 컴퓨터 안의 Postgres(PGlite, `tests/helpers/pglite-db.ts`)로 한다.
- 입력값 규칙은 `lib/landing-page-validation.ts` 한 곳에서만 정의한다.

## 진행 현황

| 단계 | 내용 | 상태 | 커밋 |
| --- | --- | --- | --- |
| 0 | 현황 파악 | ✅ 완료 | — (다른 PC에서 진행, 커밋 없음) |
| 1 | Supabase 1,000행 제한 대응 | ✅ 완료 (모의 테스트 검증, 실 DB 확인은 8단계 전) | `40ddfa3`, 테스트 `072924c` |
| 2 | 입력값 검증 규칙 분리 | ✅ 완료 | `f7bdb45` |
| 3 | 공개 대기열 DB(migration 013, 공개 함수) | ✅ 완료 (운영 미적용) | `3aa1a1b` |
| 4 | 엑셀 업로드 + 검사 + 공개 대기열 화면 | ✅ 완료 (migration 014 운영 미적용) | (바로 다음 문서 커밋에서 기록) |
| 5 | AI 생성 | ⏳ 예정 | — |
| 6 | 매일 자동 공개(Supabase pg_cron) | ⏳ 예정 | — |
| 7 | 오늘 공개 목록 화면 | ⏳ 예정 | — |
| 8 | 운영 적용·전체 테스트·사용 설명서 | ⏳ 예정 | — |

## 단계별 내용

### 0. 현황 파악
- 기존 구조(Next.js 16 App Router, Supabase, 관리자 화면, 백업/복구) 확인
- 대량 등록 시 문제가 될 부분 확인: Supabase 1회 조회 1,000행 제한, 검증 규칙이 Server Action 파일 안에 흩어져 있음

### 1. Supabase 1,000행 제한 대응
- 전체 조회는 `lib/supabase/fetch-all-rows.ts`로 1,000행씩 끝까지 읽기(sitemap, 통계, 상담 CSV, 백업·복구)
- 관리자 랜딩 목록 50개씩 서버 페이지네이션, 대시보드 숫자는 count 쿼리

### 2. 입력값 검증 규칙 분리
- `lib/landing-page-validation.ts`: 생성·수정·복제·SEO·FAQ 규칙과 대량 등록용 여러 행 검사(`validateLandingPageRows`)
- 규칙·오류 문구는 기존과 동일(회귀 테스트로 고정)

### 3. 공개 대기열 DB
- `supabase/migrations/013_publish_queue.sql`: `landing_page_queue`, `auto_publish_settings`, `publish_runs`, `landing_pages.published_at`
- `publish_queued_landing_pages(p_limit)`: ready 항목을 오래된 순으로 N개 공개, 같은 KST 날짜 재실행 차단, slug 충돌 행만 failed
- 되돌리기 `supabase/rollback/013_down.sql`, 백업 형식 version 2(대기열·published_at 포함)

### 4. 엑셀 업로드 + 검사
- 관리자 메뉴 "대량 등록": 엑셀 양식 다운로드, xlsx/csv 업로드 → 브라우저에서 파싱 → 행별 검사 결과(통과/경고/오류) → 통과 행만 대기열(ready)에 저장
- slug가 비어 있으면 `{region_slug}-{keyword_slug}`
- 문장 유사도(대표 문구+소개 문구, 글자 3-gram Jaccard): 0.6 이상 경고, 0.8 이상 오류(선택 시 hold로 저장). 기준값은 설정 화면에서 변경
- 관리자 "공개 대기열" 화면: 상태별 목록(50개씩), 검색, hold→ready, 삭제, 내용 수정
- migration 014: 유사도 기준값 컬럼(`auto_publish_settings`)

### 5. AI 생성
- 지역×키워드 조합으로 초안(대표 문구, 소개 문구, SEO, FAQ)을 생성해 대기열(draft)에 넣기
- 생성 결과도 4단계와 같은 검사(규칙 + 유사도)를 거친다

### 6. 매일 자동 공개
- Supabase pg_cron으로 매일 정해진 KST 시각에 `auto_publish_settings`(enabled, daily_limit)를 확인하고 `publish_queued_landing_pages` 실행
- 실행 결과는 `publish_runs`에 기록

### 7. 오늘 공개 목록 화면
- 오늘(KST) 공개된 페이지와 실패 항목, 실행 기록을 관리자 화면에서 확인

### 8. 운영 적용·전체 테스트·사용 설명서
- 테스트 DB(또는 로컬 Supabase)에서 실제 PostgREST로 전체 재확인(1,000행 넘는 데이터, rpc, 백업/복구)
- 운영 DB에 migration 013 → 014 → (6단계 이후 추가분) 적용(사용자 지시 후) → 코드 배포 순서 준수
- 관리자용 사용 설명서 작성
