# HANDOFF — feature/bulk-publish

마지막 업데이트: 2026-10-23 (3단계 완료, 운영 DB 미적용)

## 배경

다른 PC에서 진행했던 작업이 원격에 push되지 않아 사라졌기 때문에, 이 PC에서
`main`(4ddf124)을 기준으로 `feature/bulk-publish` 브랜치를 새로 만들고 1단계를
다시 구현했다.

## 1단계 — Supabase 1,000행 제한 대응 ✅ 구현 완료 (모의 테스트 검증 완료, 실 DB 확인 대기)

Supabase(PostgREST)는 요청 1번에 최대 1,000행(max_rows)만 돌려주며,
`.limit(10000)`처럼 더 큰 값을 줘도 오류 없이 잘린다. 랜딩페이지를 대량으로
만들기 전에, 전체 행을 읽어야 하는 곳은 전부 1,000행씩 끝까지 나눠 읽도록 바꿨다.

### 변경 내용

| 파일 | 내용 |
| --- | --- |
| `lib/supabase/fetch-all-rows.ts` (신규) | 공용 helper `fetchAllRows(buildPage)`. `range(from, to)`로 1,000행씩 반복 조회하고, 중간에 실패하면 불완전한 결과 대신 error 반환. `lib/backup/export.ts`에 있던 방식을 옮김 |
| `lib/backup/export.ts` | 자체 페이지네이션 루프를 없애고 공용 helper를 감싼 `fetchAllTableRows`로 교체(동작 동일) |
| `lib/landing-pages.ts` | `getPublicLandingPagesForSitemap`(sitemap), `getLandingPages`(통계/상담 필터 드롭다운), `suggestDuplicateSlug`를 전체 조회로 변경. 신규 `getLandingPagesPage(page)`(50개씩, count 포함), `getLandingPageCounts()`(head count 쿼리) 추가 |
| `components/admin/Pagination.tsx` | `basePath` 옵션 추가(기본값 `/admin/consultations` → 기존 상담 목록은 그대로) |
| `app/admin/pages/page.tsx` | 서버 페이지네이션(50개/페이지, `?page=N`) + 기존 Pagination 재사용 |
| `app/admin/page.tsx` | 대시보드 숫자(전체/공개/비공개)를 count 쿼리로 집계 |
| `lib/analytics.ts` | 기간별 추이·랜딩페이지별 성과의 이벤트/상담/랜딩페이지 조회를 전체 조회로 변경. `ANALYTICS_MAX_ROWS`(10,000, 실제로는 1,000에서 잘림) 제거 |
| `lib/consultation-requests.ts` | CSV 내보내기 전체 조회. `CONSULTATION_EXPORT_MAX_ROWS`(5,000, 실제로는 1,000에서 잘림) 제거 |
| `lib/backup/restore.ts` | 복구 계획 계산 시 현재 `landing_pages(id, slug)` 전체 조회(이전엔 1,000행에서 잘려 slug 충돌을 놓칠 수 있었음). `fetchAllIds`를 공용 helper로 교체하고 정렬 기준을 추가(이전엔 ORDER BY 없이 range를 써서 페이지 경계가 불안정했음) |

### 설계 메모

- 페이지 사이에 행이 빠지거나 중복되지 않도록 모든 분할 조회에 유일한 정렬 기준을 둠(`created_at` + `id` 등).
- 관리자 목록에서 마지막 페이지를 넘는 `?page=`를 요청하면 PostgREST가 PGRST103(416)을 반환함 → 오류 대신 빈 페이지와 이전 버튼을 보여줌.
- 화면 디자인 변경 없음. 랜딩페이지 목록 하단에 상담 목록과 같은 "N / M 페이지 · 이전 · 다음" 바만 추가됨.
- 1,000행씩 나눠 읽으면 행 수만큼 요청이 늘어난다(예: 이벤트 1만 건 → 요청 10번). 통계 데이터가 매우 커지면 DB 집계(RPC/view)로 바꾸는 것을 검토할 것.

### 검증

**1단계: 모의 테스트로 검증, 실 DB 확인은 3단계 전 테스트 DB에서**

- `npx tsc --noEmit` ✅ (`.next/types` 생성 후. 생성 전에는 수정하지 않은 `app/layout.tsx`의 `LayoutProps` 전역 타입 오류만 나며, Next가 생성하는 타입이라 정상)
- `npx eslint` ✅
- `npx next build` ✅
- `npm test` (vitest 모의 테스트) ✅ 6개 파일, 59개 테스트 전부 통과

#### 모의 테스트 (`npm test`)

실제 DB 없이, Supabase(PostgREST) 응답을 흉내 내는 가짜 클라이언트로 검증한다.
`@/lib/supabase/server`를 모킹하므로 네트워크 연결 자체가 없다. 운영 DB는 읽지도 쓰지도 않음.

- `tests/helpers/fake-supabase.ts`: 가짜 클라이언트
  - 요청 1번에 최대 1,000행만 돌려줌. range 없이 조회하거나 더 큰 range를 요청해도 잘림
  - `range` / `count: "exact"` / `head: true` / 필터(eq·is·gte·lt·not·like·or ilike) / 정렬 / 관계 조인 지원
  - count를 요청하면서 범위 밖 offset을 주면 PGRST103 오류
  - ORDER BY 값이 같은 행은 요청마다 순서를 섞음(실제 Postgres처럼 순서 보장 안 함). 그래서 id tie-breaker가 빠지면 테스트가 실패함
- `tests/helpers/fixtures.ts`: 데이터 0 / 1,000(경계값) / 1,200 / 2,500개. 7행씩 같은 `created_at`

| 테스트 파일 | 확인 내용 |
| --- | --- |
| `fetch-all-rows.test.ts` | 모든 크기에서 빠짐없이·중복 없이 읽음, 요청 수 = ⌊n/1000⌋+1, 중간 실패 시 불완전 결과 대신 error |
| `sitemap.test.ts` | 공개 + noindex 아닌 페이지만 정확한 개수(1,200개 → 840개), URL 중복 없음 |
| `admin-pages.test.tsx` | 50개씩 페이지 나눔(1,200개 → 24페이지, 마지막 50개 / 2,500개 → 50페이지 / 1,000개 → 20페이지), 전체 순서 일치, 범위 밖 페이지(25, 9999)는 빈 목록 + 전체 건수 + 오류 없음, 페이지 컴포넌트의 Pagination 링크(`/admin/pages?page=N`), 기본 basePath(상담 목록) 유지 |
| `dashboard.test.tsx` | 전체/공개/비공개 count 정확, head count 요청 3번만 사용, 화면에 2500 / 1875 / 625 표시 |
| `consultations-csv.test.ts` | CSV 라우트가 전체 행 내보냄(+헤더), 정렬·중복 없음, 상태·검색 필터 결과가 1,000건 넘어도 전부 내보냄, 삭제된 랜딩페이지 표시와 수식 주입 방지 유지 |
| `analytics.test.ts` | 요약 count, 기간별 추이 합계, 랜딩페이지별 성과 합계가 전체 건수와 일치. 1,000번째 이후 랜딩페이지 업체명 조회, '삭제된 랜딩페이지' 필터 |

검증 방법: 일부러 코드를 망가뜨렸을 때 테스트가 실패하는지 확인함(확인 후 원복)
- `fetchAllRows`가 첫 페이지만 읽게 바꾸면 → 18개 실패
- 관리자 목록·sitemap 정렬에서 id tie-breaker를 빼면 → 5개 실패

#### 실제 DB 확인 (아직 안 함)

- 2026-10-23: 테스트용 Supabase 프로젝트 생성을 시도했지만 무료 활성 프로젝트 2개 제한에 걸림
  - 활성 프로젝트 2개는 모두 운영 DB임
    - `jxatzdldyawjxgeepdiz` ("backhabin0's Project") = onecarepage.co.kr (이 저장소)
    - `mozfqmsjjarpsjhfjrql` (hanalandingprogram) = hanapage.co.kr
  - **두 프로젝트 모두 일시정지·삭제 금지. 운영 DB(`jxatzdldyawjxgeepdiz`)에서는 테스트 목적의 읽기·쓰기를 하지 않음**
- 3단계 전에 테스트 DB를 마련해서(Pro 업그레이드, 로컬 Docker Supabase, 다른 계정 중 택1) 실제 1,000행 넘는 데이터로 다시 확인할 것
- `.env.test.local`(git 제외)에는 프로젝트 생성용 DB 비밀번호만 들어 있음. 지금은 쓰지 않으며 그대로 둠

### 환경 메모

- 이 PC에는 원래 Node.js가 없어서 winget으로 Node.js LTS(v24.22.1)를 설치함. Git Bash에서는 PATH에 잡히지 않을 수 있으니 PowerShell을 쓰거나 `C:\Program Files\nodejs`를 PATH에 추가할 것.
- `.env.local`이 없어도 빌드는 통과함. 실제 실행에는 필요함. 모의 테스트(`npm test`)는 환경변수 없이 돌아감.
- PowerShell에서 `npx`가 실행 정책 때문에 막히면 `npx.cmd`/`npm.cmd`로 실행할 것.
- Supabase CLI와 Vercel CLI 모두 `backhabin0` 계정으로 로그인되어 있음.

## 2단계 — 입력값 검증 규칙 한 곳으로 모으기 ✅ 완료

생성·수정·복제와 앞으로 만들 대량 등록이 모두 같은 규칙을 쓰도록, 검증 규칙을
`lib/landing-page-validation.ts`(순수 함수, "use server"·DB 의존 없음)로 옮겼다.
**검증 규칙과 오류 문구는 바꾸지 않았다.**

### 변경 내용

| 파일 | 내용 |
| --- | --- |
| `lib/landing-page-validation.ts` (신규) | 제한값 상수(`LANDING_PAGE_MAX_LENGTH`, `SEO_MAX_LENGTH`, `FAQ_MAX_LENGTH`), `SLUG_PATTERN`, `isSafeExternalUrl`, `validateLandingPageInput`(예전 `normalizeAndValidate`), `validateDuplicateLandingPageInput`, `validateSeoSettingsInput`, `validateFaqInput`, 대량 등록용 `validateLandingPageRows` |
| `app/admin/pages/actions.ts` | 검증 상수·함수 삭제, 위 함수를 가져다 씀(생성·수정·복제·SEO·FAQ·공개 상태 변경). 동작 동일 |

### 제한값(기존 값 그대로)

| 대상 | 칸 | 제한 |
| --- | --- | --- |
| 기본 정보 | 업체명 / 페이지 제목 | 100 / 100 |
| | 대표 문구 / 소개 문구 | 200 / 2000 |
| | 전화번호 / 주소 / 카카오톡 URL | 30 / 200 / 500 |
| SEO | SEO 제목·OG 제목 / SEO 설명·OG 설명 | 120 / 320 |
| | 업종·카테고리 / 서비스 지역 | 100 / 200 |
| FAQ | 질문 / 답변 | 200 / 2000 |

글자 수는 앞뒤 공백을 뺀 길이 기준. 필수값: 업체명·페이지 제목·URL Slug·템플릿.
slug는 소문자로 바꾼 뒤 `^[a-z0-9]+(-[a-z0-9]+)*$` + 예약어(`lib/slug.ts`) 검사.
카카오톡 URL은 http/https만 허용(호스트는 강제하지 않음).
오류가 여러 개면 필수값 → 공개 상태 → slug 형식 → 예약어 → 글자 수(업체명→제목→대표 문구→소개→전화→주소) → 카카오 URL 순으로 첫 번째만 보여준다(기존과 같음).

### 대량 등록용 `validateLandingPageRows(rows, { firstRowNumber, existingSlugs })` — 아직 화면 연결 안 함

- 행마다 `{ rowNumber, normalized, errors, warnings }`와 전체 `validCount / errorCount / warningCount`를 돌려줌
- 한 행의 오류를 첫 번째에서 멈추지 않고 전부 모음(순서·문구는 단건 검사와 같음, 첫 오류 = 단건 오류)
- 빠진 칸은 빈 값으로 처리. 필수값 오류에는 빠진 칸 이름 목록(`fields`)을 담음
- 오류 추가: 같은 묶음 안 slug 중복(겹치는 모든 행에 "같은 URL Slug가 N행에도 있습니다."), `existingSlugs`와 겹치면 "이미 사용 중인 URL입니다."(최종 판단은 DB unique 제약)
- 경고(등록 가능): slug를 소문자/공백 제거로 바꿔 저장하는 경우, 카카오톡 URL이 kakao.com 주소가 아닌 경우
- 선택 `seo` 칸을 주면 SEO 글자 수도 검사. FAQ는 아직 대량 등록 대상에 넣지 않음
- `firstRowNumber` 기본값 1. CSV 머리글이 1행이면 2를 넘길 것

### 검증

- `npm test` ✅ 8개 파일, 237개 테스트 전부 통과(1단계 59개 + 2단계 178개)
  - `tests/landing-page-actions.test.ts` (103): 생성·수정·복제·SEO·FAQ action 회귀 테스트. 저장 함수는 spy로 바꿔 오류 문구와 저장 함수에 넘어가는 정규화 값까지 비교. **리팩터링 전 코드에서 먼저 돌려 103개 통과를 확인한 뒤** 리팩터링함
  - `tests/landing-page-validation.test.ts` (75): 규칙별 단위 테스트(필수값, 글자 수 경계값, slug 규칙, 예약어 전체, 카카오 URL, status, SEO, FAQ) + 예전 코드 복사본과 730가지 입력 조합·SEO/FAQ 조합 결과 완전 일치 + 대량 등록 함수
  - `tests/helpers/legacy-landing-page-validation.ts`: 리팩터링 전 검증 함수 원본 복사본(비교 기준용, 고치지 말 것)
- 일부러 규칙을 망가뜨려 테스트가 잡는지 확인(확인 후 원복): 카카오 제한 500→501 → 5개 실패, 주소 오류 문구 변경 → 5개, 예약어 검사 제거 → 14개, slug 소문자 변환 제거 → 46개
- `npx tsc --noEmit` ✅ / `npx eslint` ✅ / `npx next build` ✅
- 운영 DB 접속 없음(테스트는 전부 모의)

### 메모

- 요청서의 "1-1 표"는 저장소에 없어서, 기존 `actions.ts`에 있던 제한값을 그대로 옮기고 테스트로 고정했다(위 표). 표와 다른 값이 있으면 알려줄 것.
- ~~화면 입력칸의 `maxLength`는 아직 숫자를 직접 씀~~ → 3단계에서 공용 상수로 바꿈.

## 3단계 — 공개 대기열 migration + 하루 단위 공개 함수 ✅ 완료 (운영 DB 미적용)

**운영 DB에는 아직 적용하지 않았다.** 운영 적용은 마지막 단계에서 따로 진행한다.
검증은 컴퓨터 안에서만 도는 Postgres(PGlite)로 했고, 운영 DB·다른 Supabase 프로젝트에는 접속하지 않았다.

### 변경 내용

| 파일 | 내용 |
| --- | --- |
| `supabase/migrations/013_publish_queue.sql` (신규) | 아래 "migration 013" 참고 |
| `supabase/rollback/013_down.sql` (신규) | 운영 적용 실패 시 수동으로 되돌리는 SQL. migrations 폴더 밖이라 CLI가 자동 실행하지 않음 |
| `types/publish-queue.ts` (신규) | 대기열 행 타입, state/source 목록 |
| `types/landing-page.ts` | `LandingPage.published_at` 추가 |
| `types/backup.ts`, `lib/backup/{export,sanitize,restore}.ts` | 백업 형식 version 2 (아래) |
| `app/admin/settings/backup/*`, `components/admin/BackupRestorePanel.tsx` | 현재 데이터 현황·dry-run·복구 결과에 "공개 대기열" 한 줄씩 추가 |
| `components/admin/FaqManager.tsx`, `SeoSettingsPanel.tsx` | 입력칸 `maxLength`를 `lib/landing-page-validation.ts`의 `FAQ_MAX_LENGTH`/`SEO_MAX_LENGTH`로 교체(값 같음, 화면 변화 없음) |
| `tests/helpers/pglite-db.ts` (신규) | PGlite에 Supabase 흉내(anon/authenticated/service_role 역할, auth.uid(), storage 테이블, 기본 권한) + migration 001~013 적용 |
| `tests/helpers/fake-supabase.ts` | 백업 복구 테스트용 insert/upsert/update/maybeSingle 추가 |
| `package.json` | devDependency `@electric-sql/pglite` 0.5.8 (2026-08-26 배포, PostgreSQL 18) |

### migration 013

- `landing_pages.published_at timestamptz null` — 기본값 없음. 기존 행은 null 그대로이고 다른 값·`updated_at`도 바뀌지 않음(테스트로 확인)
- `landing_page_queue` — region, keyword, region_slug, keyword_slug, 랜딩페이지 입력칸(business_name, title, slug, hero_text, description, phone, kakao_url, address, template), seo_title, seo_description, service_area, business_category, faqs(jsonb), source(ai/excel), state(draft/ready/hold/published/failed, 기본 draft), validation_errors(jsonb 배열), max_similarity(0~1), priority, published_at, landing_page_id(→ landing_pages, 삭제 시 null), batch_id, created_at
  - `unique(slug)`, `unique(region, keyword)`
  - SEO 칸 글자 수 제한은 009와 같게 DB에서도 검사, faqs는 `is_valid_queue_faqs()`로 형식 검사(배열, 각 항목 question ≤200 / answer ≤2000, 빈 값 불가). 공개 단계에서 insert가 실패하지 않도록 대기열에 넣을 때 막음
- `auto_publish_settings` — 단일 행(`id='default'`), enabled 기본 false, daily_limit 기본 50(1~1000)
- `publish_runs` — run_date(KST 날짜, unique), requested_limit, published_count, failed_count, started_at, finished_at
- 새 테이블 3개 모두 RLS 켜고 `authenticated` 정책만(anon 정책 없음). publish_runs는 삭제 정책 없음(기록 보존)
- `publish_queued_landing_pages(p_limit)` → jsonb `{status, run_date, published, failed, published_ids, failed_ids}`
  1. 같은 KST 날짜 실행 기록이 있으면 아무것도 바꾸지 않고 `status: "already_ran"` (동시 호출도 unique 제약으로 한 번만)
  2. ready 항목을 `created_at, id` 오래된 순으로 최대 p_limit개 `for update skip locked`
  3. landing_pages(status=public, published_at=now()) + seo_settings + faqs insert → 대기열을 published(published_at, landing_page_id 기록)로
  4. slug가 이미 landing_pages에 있으면 그 행만 failed + validation_errors에 `slug_conflict`
  5. 그 밖의 예상 못 한 오류는 다시 던짐 → 전체 롤백, 실행 기록도 안 남아서 고친 뒤 같은 날 재실행 가능
  - `security invoker`(호출자 권한, RLS 적용), `search_path = ''`
  - 실행 권한: `authenticated`와 소유자 `postgres`만. Supabase가 새 함수에 기본으로 주는 anon/service_role 권한까지 회수
  - p_limit은 1~1000만 허용. `auto_publish_settings.enabled`는 함수가 보지 않음 → 자동 실행(크론) 쪽에서 확인하고 daily_limit을 넘길 것
  - 실패한 행도 p_limit 개수에 포함됨(그날 고른 N개 중 성공한 것만 공개)
  - priority 컬럼은 만들었지만 공개 순서에는 쓰지 않음(요청대로 오래된 순)

### 백업 형식 version 2

- `landingPages[].published_at`과 `publishQueue`(대기열 전체, 1,000행씩 끝까지)를 추가
- version 1 파일도 계속 읽음: published_at 키가 없으므로 복구 시 published_at을 쓰지 않아 **현재 값 유지**, 대기열은 빈 배열
- 대기열 복구: id 기준 upsert. slug나 (region, keyword)가 현재 다른 항목과 겹치거나 백업 안에서 겹치면 그 행만 건너뜀(랜딩페이지 충돌처럼 전체를 막지는 않음). 연결된 랜딩페이지가 복구 후에도 없으면 landing_page_id를 비우고 씀
- 복구 순서: landing_pages → seo → faqs → 상담 → 이벤트 → **대기열** → 검색엔진 인증

### 검증

- `npm test` ✅ 10개 파일, 272개 테스트 전부 통과(이전 237 + 신규 35)
  - `tests/publish-queue.db.test.ts` (23, PGlite): migration 001~013 적용 →
    대기열 120개·p_limit 50 → 오래된 50개 공개·70개 대기·published_at 기록·SEO 50개·FAQ 100개·실행 기록 / 같은 날 재실행 차단 / 어제 기록은 오늘 실행을 막지 않음 / 대기 30개면 30개만 / 대기 0개도 기록 / slug 충돌 행만 failed / ready 외 상태는 안 건드림 / 예상 못 한 오류 시 전체 롤백 후 재실행 가능 / p_limit 범위 / 권한(anon·service_role 실행 거부, anon은 새 테이블 읽기·쓰기 불가) / 012 상태 DB에 013 적용 시 기존 행 값 그대로 / 013 두 번 적용 가능 / 013_down 후 013 것만 사라지고 기존·공개된 페이지는 남음, 다시 013 적용 가능
  - `tests/backup-publish-queue.test.ts` (12, 가짜 클라이언트): 내보내기(1,200 페이지·1,100 대기열), version 1/2 읽기, 형식 틀린 행 제외, `__proto__` 무시, 내보낸 파일을 빈 DB에 복구 시 그대로 복원, version 1 복구 시 published_at 유지, 대기열 충돌·연결 해제, 랜딩페이지 충돌 시 대기열도 안 씀
- 일부러 망가뜨려서 테스트가 잡는지 확인(확인 후 원복)
  - SQL: 정렬을 priority 우선으로 → 2개 실패, 같은 날 차단 제거 → 2개, anon 권한 회수 제거 → 1개, published_at 미기록 → 2개, published_at에 기본값 now() → 3개
  - 백업: v1에서도 published_at을 null로 씀 → 1개, 대기열 충돌 검사 제거 → 1개, 연결 해제 제거 → 1개, 내보내기에서 대기열 누락 → 2개, published_at 형식 검사 제거 → 1개
  - slug 충돌의 사전 검사(exists)와 unique_violation 처리는 서로 백업 관계라 하나만 빼면 테스트가 통과함(각각 단독으로도 정상 동작한다는 뜻)
- `npx tsc --noEmit` ✅ / `npx eslint` ✅ / `npx next build` ✅
  - 빌드 중 나오는 "Dynamic server usage ... cookies" 로그는 이번 변경 전에도 똑같이 나옴(빌드 성공, 기존 동작)

### 운영 적용 전에 알아둘 것

- **배포 순서: 운영 DB에 013을 먼저 적용한 뒤 이 브랜치 코드를 배포할 것.** 코드가 먼저 나가면 백업 내보내기·백업 화면 현황(대기열 count)·복구가 "테이블/컬럼 없음"으로 실패함. 이 브랜치의 Vercel Preview가 운영 DB 환경변수를 쓰고 있다면 Preview의 백업 화면도 같은 이유로 실패함(다른 화면은 영향 없음)
- 실 Supabase(PostgREST)에서만 확인 가능한 부분은 아직 안 봄: `supabase.rpc("publish_queued_landing_pages")` 호출, PostgREST의 upsert가 보낸 컬럼만 덮어쓰는지(version 1 복구 시 published_at 유지의 전제), 대기열 1,000행 넘는 실제 내보내기
- PGlite는 PostgreSQL 18, Supabase는 15/17 — 사용한 문법(on conflict, for update skip locked, jsonb 함수, security invoker)은 모두 15부터 지원
- `for update skip locked`의 동시 실행 동작은 PGlite가 연결 1개라 테스트하지 못함(동시 2회 실행 자체는 publish_runs unique로 막힘)
- 롤백 SQL은 대기열·설정·실행 기록·published_at 값을 지움. 실행 전 백업 받을 것

### 메모

- 요청서의 "0단계 계획"은 저장소에 없어서 이번 요청서에 적힌 컬럼·규칙대로 만들었다. 계획과 다른 점이 있으면 알려줄 것.
- 백업에는 대기열만 넣었고 `auto_publish_settings`·`publish_runs`는 넣지 않았다(요청 범위). 필요하면 추가.

## 다음 단계

1. bulk publish(대량 생성·공개) 기능 본 작업 — 행 검사는 `validateLandingPageRows` 사용, 대기열 저장은 `landing_page_queue`
2. 운영 적용 전: 테스트 DB(또는 로컬 Supabase)에서 실제 PostgREST로 rpc 호출·백업/복구·1,000행 넘는 데이터 재확인
3. 마지막 단계: 운영 DB에 013 적용(사용자 지시 후) → 코드 배포
