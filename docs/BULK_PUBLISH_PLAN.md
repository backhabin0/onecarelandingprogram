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
| 4 | 엑셀 업로드 + 검사 + 공개 대기열 화면 | ✅ 완료 (migration 014 운영 미적용) | `1e6f06d` |
| 5 | AI용 프롬프트 만들기(AI API 연결 없음) | ✅ 완료 | `3366e56` |
| 6 | 매일 자동 공개(Supabase pg_cron) + 검색엔진 알림(IndexNow) | ✅ 완료 (migration 015·cron 등록 운영 미적용) | `48be4f0` |
| 7 | SEO 강화 + 오늘 공개 목록 | ✅ 완료 (migration 016 운영 미적용) | `ee002d9` |
| 8 | 운영 적용·전체 테스트·Next.js 보안 업데이트·사용 설명서 | 🔄 진행 중 (8-1 운영 현황 확인 완료: 운영 sitemap 1,000개로 잘림 확인) | (바로 다음 문서 커밋에서 기록) |

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

### 5. AI용 프롬프트 만들기 (AI API 연결 없음)
- 계획 변경(2026-10-23): 서비스가 AI API를 직접 호출하지 않는다. 손님이 ChatGPT·Claude 같은 AI에 프롬프트를 직접 넣고, 받은 표를 업로드한다
- "대량 등록" 화면의 '프롬프트 만들기' 탭: 지역 목록(지역명 + region_slug), 키워드 목록(키워드 + keyword_slug), 공통 업체 정보(업체명·전화·카카오·주소·템플릿), 업종 설명(선택) → 조합 수 표시, 50개 넘으면 50개씩 나눈 프롬프트 여러 개, '프롬프트 복사'
- 프롬프트: 양식과 같은 열 순서의 탭 구분 표만 출력(머리글 포함, 설명 없이), 입력값 칸은 그대로 복사, AI는 제목·대표 문구·소개 문구·SEO·FAQ 1~3만 작성, 글자 수 제한(공용 상수) 숫자로 명시, 행마다 지역 특성·상황 다르게, 반복·키워드 억지 반복 금지, 사실 정보(가격·할인·수상·경력·연락처) 지어내기 금지
- 붙여넣기 업로드: AI가 준 표(탭 구분, 머리글 있음/없음, 마크다운 표도 허용)를 붙여넣으면 엑셀 업로드와 같은 검사
- 업로드 검사에 소개 문구·FAQ의 전화번호·금액 패턴 경고 추가

### 6. 매일 자동 공개 + 검색엔진 알림(IndexNow)
- migration 015: 래퍼 함수 `run_auto_publish(p_manual)` — 매일 실행은 `auto_publish_settings.enabled`일 때만, 하루 개수 = daily_limit(1~100, 기본 50). 실행 기록에 자동/지금 실행 구분
- pg_cron 등록은 `supabase/manual/015_cron_schedule.sql`(매일 00:00 UTC = 09:00 KST)로 분리 — pg_cron이 꺼져 있어도 migration은 실패하지 않음
- 관리자 설정 화면: 자동 공개 켜기/끄기, 하루 개수, 최근 실행 기록, '지금 1회 실행'(같은 날 중복 차단)
- IndexNow: 공개 후 앱이 "아직 알리지 않은 공개 페이지"를 모아 네이버 IndexNow(`searchadvisor.naver.com/indexnow`, 참여 엔진 간 공유)로 전송, 결과 기록·실패 시 재시도. 관리자 대시보드 접속 시·'지금 1회 실행' 뒤·`/api/indexnow`(로그인 또는 CRON_SECRET, Vercel Cron 매일 00:10 UTC)
- sitemap lastmod = published_at·updated_at 중 최신

### 7. SEO 강화 + 오늘 공개 목록
- 메뉴 "대량 등록" → "AI 대량 생성"(URL /admin/bulk 그대로)
- 공개 대기열 화면에 '공개된 주소'(한국 날짜 선택, 한 줄에 하나, 전체 복사 — 네이버 수집 요청용)
- 양식 새 칸(맨 뒤): 시/군·city_slug·대표 사진 URL·사진 설명(alt)·현장 사례. 구 양식 계속 읽힘, 프롬프트에서는 빈칸 유지
- migration 016: 랜딩페이지·대기열에 지역 SEO 칸, 공개 함수가 복사, 얇은 페이지 noindex 옵션(기본 꺼짐)
- 지역 모음 페이지 /area/{city_slug}('area' 예약어), 공개 페이지가 1개 이상일 때만, sitemap 포함
- 내부 링크: 같은 지역 다른 서비스(최대 5)·근처 지역 같은 서비스(같은 시/군, 최대 5)·지역 모음 링크
- 페이지 SEO: 제목·H1(1개) 앞쪽에 "지역 키워드", LocalBusiness areaServed, BreadcrumbList(홈 > 시/군 > 페이지), FAQPage, 사진 alt 자동, next/image, 현장 사례 섹션
- 업로드 경고: 키워드 과다 반복, 얇은 페이지
- 백업 형식 version 3(새 칸 포함, 예전 형식 계속 읽음)

### 8. 운영 적용·전체 테스트·사용 설명서
- 테스트 DB(또는 로컬 Supabase)에서 실제 PostgREST로 전체 재확인(1,000행 넘는 데이터, rpc, 백업/복구)
- 운영 DB에 migration 013 → 014 → (6단계 이후 추가분) 적용(사용자 지시 후) → 코드 배포 순서 준수
- Next.js 보안 업데이트: `npm audit`에서 next 16.3.4에 critical 경고가 있음(4단계에서 확인). 패치 버전으로 올리고 전체 테스트·빌드 재확인
- 관리자용 사용 설명서 작성
