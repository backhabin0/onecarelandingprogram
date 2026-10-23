# HANDOFF — feature/bulk-publish

마지막 업데이트: 2026-10-23 (6단계 완료, 운영 DB 미적용)

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

## 4단계 — 엑셀 대량 등록 + 검사 + 공개 대기열 화면 ✅ 완료 (운영 DB 미적용)

전체 계획과 단계별 커밋은 `docs/BULK_PUBLISH_PLAN.md`에 있다.

### 화면

- 관리자 메뉴에 **대량 등록**(`/admin/bulk`)과 **공개 대기열**(`/admin/queue`) 추가(기존 사이드바·카드·표 스타일 그대로)
- 대량 등록
  1. **엑셀 양식 다운로드**(`/admin/bulk/template`, 로그인 필요): 열 = 지역, 키워드, region_slug, keyword_slug, 업체명, 페이지 제목, 대표 문구, 소개 문구, 전화, 카카오 URL, 주소, 템플릿, SEO 제목, SEO 설명, FAQ 질문1~3/답변1~3. 첫 줄 머리글(굵게, 고정) + 예시 1행, 모든 칸 텍스트 형식(전화번호 앞 0 보존)
  2. **파일 올리기**: xlsx/csv를 **브라우저에서** 파싱 → 서버에서 비교 정보(이미 쓰는 slug, 대기열 지역·키워드, 같은 키워드 기존 문구)만 받아 → 브라우저에서 검사 → 결과 표(행 번호별 통과/경고/오류, 유사도, 문구, 필터)
  3. **대기열에 넣기**: 통과·경고 행만 `state=ready`로 저장. 유사도 오류만 있는 행은 체크박스를 켜면 `state=hold`로 저장. 요청은 600KB·200행 단위로 나눠 순서대로 보내고(Server Action 기본 1MB 제한), **서버가 같은 규칙으로 다시 검사**한 뒤 저장. 결과로 ready/hold/건너뜀(이유) 표시
- 공개 대기열: 상태 탭(전체/공개 대기/보류/초안/실패/공개됨 + 건수), 검색(지역·키워드·업체명·제목·URL), 50개씩 페이지, 공개 순서(오래된 순)로 정렬, 선택 항목 보류→공개 대기·삭제, 행별 수정/공개 대기로/삭제. 공개된 항목은 선택·수정·삭제 불가(페이지 보기 링크)
- 대기열 항목 수정(`/admin/queue/[id]/edit`): 모든 칸 + 상태(공개 대기/보류/초안). 같은 규칙으로 재검사(자기 자신은 비교 제외). 유사도 오류면 ready로 저장 불가(hold/draft만)
- 설정 화면에 **대량 등록 문장 유사도 기준** 카드(경고/오류 기준값)

### 검사 규칙(`lib/bulk-upload/check.ts`, 브라우저·서버 공용)

- 기본 규칙은 2단계 `validateLandingPageRows` 그대로(필수값, 글자 수, slug 형식, 예약어, 카카오 URL, SEO 글자 수, 파일 안 slug 중복, 이미 쓰는 slug). 상태는 항상 public으로 검사(공개 시 public이 되므로)
- 대량 등록 전용: 지역·키워드·region_slug·keyword_slug 필수, region_slug/keyword_slug 형식, FAQ 질문·답변 짝과 글자 수, (지역, 키워드) 중복(파일 안 + 대기열), 템플릿은 template-a/template-b만(비면 template-a), 숫자로 저장된 전화번호 경고
- slug 열은 양식에 없음. 비면 `{region_slug}-{keyword_slug}`. 머리글에 `URL Slug` 열을 넣으면 그 값을 씀
- **문장 유사도**: 대표 문구+소개 문구를 정규화(NFKC, 소문자, 글자·숫자 외 제거) → 글자 3-gram Jaccard. 비교 대상은 같은 키워드의
  - 대기열 항목(공개 전): 대기열 문구 / 공개된 대기열 항목: 연결된 랜딩페이지의 **현재** 문구
  - 대기열을 거치지 않은 기존 페이지: 키워드 칸이 없어서 **페이지 제목에 키워드가 들어 있으면** 같은 키워드로 봄
  - 같은 파일의 **앞쪽 행**(유사도 외 오류가 없는 행). 뒤 행과 비교하지 않는 이유: 서버가 나눠 저장할 때 앞 묶음이 먼저 대기열에 들어가므로 미리보기와 실제 저장 결과가 같아짐
  - 기준값 기본 0.6 경고 / 0.8 오류, 설정에서 변경(`auto_publish_settings`, migration 014)
- 대기열 `validation_errors`에는 오류·경고를 `level`과 함께 저장, `max_similarity`는 소수 넷째 자리까지 내림

### 변경 파일

| 파일 | 내용 |
| --- | --- |
| `supabase/migrations/014_bulk_upload_similarity_settings.sql` (신규) | `auto_publish_settings`에 similarity_warning_threshold(0.60)·similarity_error_threshold(0.80) + check(0 < 경고 < 오류 ≤ 1). 되돌리기 `supabase/rollback/014_down.sql` |
| `lib/bulk-upload/columns.ts` | 양식 열 정의, 머리글 정규화 |
| `lib/bulk-upload/parse.ts` | CSV(RFC 4180, UTF-8/BOM, 실패 시 CP949) + xlsx(`read-excel-file/universal`) → 행. 머리글 이름으로 열 찾기, 빈 줄 건너뜀(줄 번호 유지), 최대 2,000행·10MB, .xls 거부 |
| `lib/bulk-upload/similarity.ts` | 정규화, 3-gram, Jaccard, 키워드별 역색인(`SimilarityIndex`) |
| `lib/bulk-upload/check.ts` | 행 검사, 저장 상태 결정(ready/hold/건너뜀) |
| `lib/bulk-upload/payload.ts` | 요청 나누기(크기·행 수), 서버 입력 확인(알려진 칸·길이·uuid) |
| `lib/bulk-upload/context.ts` | 비교 정보 조회(전부 1,000행씩 끝까지, `.in()`은 100개씩) |
| `lib/bulk-upload/enqueue.ts` | 서버 재검사 + 대기열 저장. 묶음 insert가 unique 충돌(23505)이면 한 행씩 다시 넣어 충돌 행만 건너뜀 |
| `lib/bulk-upload/template.ts`, `app/admin/bulk/template/route.ts` | 양식 xlsx 생성(`write-excel-file`) |
| `lib/bulk-publish-settings.ts` | 유사도 기준값 조회·저장(조회 실패 시 기본값 + 안내 문구) |
| `lib/publish-queue.ts`, `lib/publish-queue-labels.ts` | 대기열 목록·건수·조회·수정·보류 해제·삭제 |
| `app/admin/bulk/*`, `app/admin/queue/*`, `components/admin/{BulkUploadPanel,BulkCheckResultTable,QueueTable,QueueStateTabs,QueueSearchForm,QueueStateBadge,QueueItemForm,SimilaritySettingsPanel}.tsx` | 화면 |
| `components/admin/AdminSidebar.tsx`, `app/admin/settings/{page,actions}.ts(x)` | 메뉴 2개, 설정 카드·저장 action |
| `lib/landing-page-validation.ts` | `validateLandingPageRows`에 `rowNumbers` 옵션(빈 줄을 건너뛴 실제 줄 번호), 대량 등록용 issue code 추가. 기존 규칙·문구 변경 없음 |
| `package.json` | dependencies `read-excel-file` 9.3.12(2026-10-07 배포), `write-excel-file` 4.1.1(2026-06-08). npm의 `xlsx`(SheetJS)는 0.18.5에서 멈춰 있고 알려진 취약점이 있어 쓰지 않음 |
| `tests/helpers/pglite-supabase.ts` (신규) | PGlite 위에서 supabase-js 쿼리 빌더처럼 동작하는 테스트용 어댑터(authenticated 역할, 1,000행 제한, PGRST103, 오류 코드) |

### 검증

- `npm test` ✅ 15개 파일, 344개 테스트(이전 272 + 신규 72)
  - `bulk-upload-parse.test.ts` (13): CSV 따옴표·줄바꿈·CRLF·BOM, UTF-8/CP949 한글, 머리글 이름 매칭(순서·공백·대소문자), 모르는 열 무시, 필수 머리글 없음·중복, 빈 줄(줄 번호 유지), 숫자 전화번호 경고, 2,000행 초과, xlsx 한글·빈 줄, **다운로드 양식을 그대로 올리면 예시 행 통과**, 손상 xlsx·xls·기타 형식·10MB 초과
  - `bulk-upload-similarity.test.ts` (11): 정규화, 3-gram, Jaccard 값, 역색인 결과 = 모든 쌍 직접 계산, 64개 넘는 문서, 기준값 검사
  - `bulk-upload-check.test.ts` (19): slug 자동 생성, 기존 규칙 그대로, 대량 등록 전용 규칙, 중복, 유사도 경고/오류/hold, 다른 키워드 제외, 앞 행만 비교, 요청 나누기(최대 크기 한글 행도 600KB 이하), 서버 입력 거부
  - `bulk-upload-queue.db.test.ts` (18, PGlite + migration 001~014): ready 저장 값, 오류 행 건너뜀, 유사도 hold/건너뜀, 나눠 보낸 앞 묶음이 다음 묶음 비교 대상, 대기열 지역·키워드 중복, unique 충돌 시 그 행만 건너뜀, 저장 → 3단계 공개 함수로 공개(hold는 남음), 비교 대상 조회(공개 항목은 페이지 현재 문구, 제목 키워드 매칭, 자기 자신 제외, `%` 이스케이프), 목록 50개씩·범위 밖·검색·건수, 보류 해제·삭제 범위, 수정 재검사, 014 기본값·제약·롤백, Server Action 입력 거부
  - `bulk-components.test.tsx` (11): 메뉴, 결과 표, 업로드 화면, 상태 탭, 목록 버튼, 수정 폼, 설정 카드, PGlite 데이터로 공개 대기열 페이지 렌더링(3페이지, 보류 탭+검색)
- 일부러 망가뜨려서 테스트가 잡는지 확인(확인 후 원복): 오류 행도 유사도 비교 대상에 넣음 → 1개 실패, 공개 항목에 대기열 사본 문구 사용 → 1개, 23505 한 행씩 재시도 제거 → 1개, 보류 해제가 hold 외에도 적용 → 1개, 공개된 항목도 삭제 → 1개, 빈 줄 건너뛰기 제거 → 3개, 지역·키워드 중복 검사 제거 → 2개, 서버 재검사 없이 모두 ready → 5개
- 속도: 같은 키워드 2,000행 + 기존 문구 3,000개 검사 약 0.7초(테스트 PC)
- `npx tsc --noEmit` ✅ / `npx eslint` ✅ / `npx next build` ✅(빌드 로그의 "Dynamic server usage"는 기존과 같음)

### 알아둘 것

- 운영 적용 순서에 014 추가: **013 → 014 적용 후 코드 배포**. 014 없이 배포하면 유사도 기준은 기본값으로 동작(화면에 안내)하지만 설정 저장은 실패함
- 화면 상호작용(파일 선택, 버튼 클릭)은 자동 테스트하지 않았다(요청대로 컴포넌트 테스트까지). 실제 브라우저 확인은 8단계 전 테스트 DB에서 할 것
- 대기열 밖 기존 페이지를 "같은 키워드"로 보는 기준(제목에 키워드 포함)은 추정이다. 키워드가 제목에 없는 기존 페이지는 비교하지 않는다
- 서비스 지역·업종(service_area, business_category)은 양식에 없어 비워 둔다(지역·키워드로 추측해 채우지 않음 — 기존 SEO 방침)
- 미리보기와 실제 저장 결과가 다를 수 있는 경우: 미리보기 후 다른 사람이 대기열을 바꾼 경우, 또는 유사도 오류 행을 hold로 저장하지 않았는데 뒤 행이 그 행과만 비슷했던 경우. 최종 결과는 서버 재검사 기준이며 저장 후 화면에 표시됨
- `npm audit --omit=dev`의 경고(next 16.3.4 critical, sharp, source-map-js)는 이번 변경 전부터 있던 것. 새 라이브러리 관련 경고는 없음. next 보안 업데이트는 별도로 검토 필요

## 5단계 — AI용 프롬프트 만들기 ✅ 완료 (AI API 연결 없음)

**계획 변경:** 서비스는 AI API를 호출하지 않는다. 손님이 ChatGPT·Claude 같은 AI에 프롬프트를 직접 넣고, 받은 표를 붙여넣거나 엑셀로 올린다. (처음 받은 "AI API 연결" 요청은 파일 변경 전에 취소됨 — SDK 설치·키·호출 모두 없음)

### 화면

- 대량 등록 화면에 탭 2개: **올리기(엑셀·붙여넣기)**(`/admin/bulk`) / **프롬프트 만들기**(`/admin/bulk?tab=prompt`)
- 프롬프트 만들기(`components/admin/PromptBuilderPanel.tsx`, 서버 호출 없음)
  - 지역 목록·키워드 목록: 한 줄에 하나, "이름, slug"(쉼표·탭·마지막 공백 구분). slug 형식·중복을 줄 번호와 함께 표시
  - 공통 업체 정보(업체명 필수, 전화, 카카오 URL, 주소, 템플릿) + 업종 설명(선택)
  - 조합 수 표시(지역 × 키워드), **50개 넘으면 50개씩 나눈 프롬프트 여러 개**, 각각 '프롬프트 복사' 버튼(복사 실패 시 직접 선택 안내)
  - 조합 2,000개(한 번에 올릴 수 있는 최대 행 수) 초과 시 오류
- 올리기 탭에 **표 붙여넣기** 칸 + '붙여넣은 표 검사' → 엑셀 업로드와 똑같은 검사·결과 표·대기열 저장

### 프롬프트 내용(`lib/bulk-upload/prompt.ts`)

- 출력: 양식과 같은 열 순서의 **탭 구분 표 하나만**(머리글 포함), 설명·인사말·코드 블록·마크다운 기호 금지, 칸 안 탭·줄바꿈 금지, 행 수·순서 유지
- 그대로 복사할 칸: 지역, 키워드, region_slug, keyword_slug, 업체명, 전화, 카카오 URL, 주소, 템플릿 — 프롬프트 끝의 [입력 표]에 값을 미리 채워 줌(AI가 쓸 칸은 빈 칸)
- AI가 쓰는 칸과 글자 수(공용 상수에서 가져옴): 페이지 제목 100, 대표 문구 200, 소개 문구 2000, SEO 제목 120, SEO 설명 320, FAQ 질문 200 / 답변 2000
- 작성 규칙: 행마다 생활 환경(아파트 단지·상가·주택가·음식점 거리·학원가 등)과 고객 상황을 다르게(단 특정 건물·역·거리·통계 같은 확인 안 된 지역 정보는 금지), 같은 문장·구조 반복 금지, 키워드 억지 반복 금지, 가격·할인·이벤트·수상·경력·인증·회원 수·순위·연락처 지어내기 금지, 연락처는 해당 칸에만
- 업체 정보 값의 탭·줄바꿈은 공백으로 바꿔 표가 깨지지 않게 함

### 붙여넣기 파싱(`lib/bulk-upload/parse.ts` `parsePastedUpload`)

- 탭 구분(엑셀·구글 시트 복사, AI 출력). AI가 마크다운 표(`| a | b |`)나 코드 블록으로 줘도 읽음
- 첫 줄에 양식 머리글이 3개 이상 있으면 머리글로 보고, 없으면 **양식 열 순서**로 읽음(이때 줄 번호 = 붙여넣은 줄 번호). 머리글 없이 칸이 양식보다 많으면 거부
- 빈 줄 건너뜀(줄 번호 유지), 앞쪽 빈 줄 무시. 칸 안 줄바꿈은 지원하지 않음(한 줄 = 한 행)
- 서버 입력 확인의 최소 줄 번호를 2 → 1로 변경(머리글 없는 붙여넣기의 첫 줄)

### 사실 정보 경고(`lib/bulk-upload/check.ts` `collectFactWarnings`)

- **소개 문구·FAQ 질문/답변 1~3**에 아래 패턴이 있으면 경고(저장은 막지 않음 — 실제 업체 정보일 수 있으므로). 대표 문구·전화 칸은 보지 않음
  - 전화번호: 010-1234-5678, 02)123-4567, 02 123 4567, 01012345678, 1588-1234, +82 10-1234-5678
  - 금액·할인: 50,000원, 3만원, 5천 원, 1억, ₩10000, 30% 할인, 12.5% off
  - 경고하지 않는 예: 1:1, 주 3회, 2024년, 3분, 100% 예약제
- 엑셀·붙여넣기·대기열 항목 수정 모두 같은 검사를 쓰므로 함께 적용됨

### 검증

- `npm test` ✅ 16개 파일, 380개 테스트(이전 344 + 신규 36)
  - `tests/bulk-prompt.test.ts` (35): 목록 읽기(구분자 3종, 소문자, 빈 줄, 줄 번호 오류), 조합 수, 50개 분할(120 → 50·50·20, 각 프롬프트 머리글, 합치면 전체), 글자 수 숫자 = 공용 상수, 작성 규칙 문구, 입력 표(고정 칸 값·빈 AI 칸·탭/줄바꿈 정리), 입력 부족·2,000개 초과, **프롬프트의 표를 AI처럼 채워 붙여넣으면 검사 통과**, 붙여넣기(머리글 있음/없음, 한글, 빈 줄, CRLF, 마크다운·코드 블록, 칸 수 초과, 빈 입력), 전화번호·금액 패턴과 오탐 방지, 경고 칸 표시, 검사 결과에서 경고(ready 저장 가능)
  - `bulk-components.test.tsx`: 붙여넣기 칸, 프롬프트 만들기 화면 입력칸·초기 안내
- 일부러 망가뜨려서 테스트가 잡는지 확인(확인 후 원복): 분할 개수 60, 소개 문구 글자 수 고정값, 머리글 없는 표 처리 제거, 마크다운 지원 제거, 사실 정보 경고 연결 제거, 고정 칸 전화 누락 → 모두 1~2개 실패
- `npx tsc --noEmit` ✅ / `npx eslint` ✅ / `npx next build` ✅(빌드 로그 "Dynamic server usage" 4줄은 기존과 같음)
- 새 migration·라이브러리·환경변수 없음

## 6단계 — 매일 자동 공개 + 검색엔진 알림(IndexNow) + sitemap lastmod ✅ 완료 (운영 미적용)

### 매일 자동 공개

- `supabase/migrations/015_auto_publish_indexnow.sql`
  - `run_auto_publish(p_manual boolean default false)`: 설정 행을 읽어 `publish_queued_landing_pages(daily_limit)` 호출
    - 매일 실행(`p_manual=false`): `auto_publish_settings.enabled = true`일 때만. 꺼져 있으면 `{status: "disabled"}`, 공개·실행 기록 모두 없음(그날 나중에 '지금 실행' 가능)
    - '지금 1회 실행'(`p_manual=true`): 켜짐/꺼짐과 관계없이 실행
    - 같은 KST 날짜 중복 차단은 3단계 공개 함수 그대로. 실행 기록 `publish_runs.trigger`에 cron/manual 기록(새 컬럼)
    - 실행 권한: authenticated + postgres(pg_cron 작업 소유자)만
  - 하루 개수 제약을 1~100으로 좁힘(013은 1~1000)
- **pg_cron 등록은 별도 파일 `supabase/manual/015_cron_schedule.sql`**(migration 폴더 밖, 자동 실행 안 됨)
  - 운영 적용 방법(8단계, 사용자 지시 후): ① migration 015 적용 ② Dashboard > Database > Extensions에서 pg_cron 켜기 ③ 파일의 [A] 실행 → `cron.job`에 `onecare-daily-auto-publish`, `0 0 * * *`(매일 00:00 UTC = 09:00 KST) 확인 ④ 관리자 설정에서 "자동 공개 켜기"(기본 꺼짐)
  - 여러 번 실행해도 작업은 1개(같은 이름은 지우고 다시 등록). 완전히 멈출 때는 [C], 잠시 멈출 때는 설정에서 끄기
- 관리자 설정 화면 "매일 자동 공개" 카드: 켜기/끄기, 하루 개수(1~100, 기본 50), 최근 실행 기록 10개(날짜·방식·공개·실패·끝난 시각), '지금 1회 실행'(확인 창, 같은 날 이미 실행됐으면 안내만)

### 검색엔진 알림(IndexNow)

- 문서 확인(2026-10-23): indexnow.org/documentation — POST JSON `{host, key, keyLocation, urlList}`, 한 번에 최대 10,000개, 200=접수 / 202=접수(키 확인 대기) / 400·403·422·429=실패, 키는 영문·숫자·하이픈 8~128자, 키 파일은 사이트 루트 `{key}.txt`. indexnow.org/faq — 네이버 엔드포인트 `https://searchadvisor.naver.com/indexnow`, **참여 엔진 한 곳에 보내면 Bing 등 다른 IndexNow 엔진에도 공유됨** → 네이버 한 곳에만 보낸다
  - 네이버 서치어드바이저 안내 페이지는 이 환경에서 열리지 않아 직접 확인하지 못했다(사이트 등록 필요 여부 등은 운영 적용 때 서치어드바이저에서 확인할 것)
- 키: `public/d8480180f2798f02382139f1dfd53952.txt`(내용 = 같은 값). 운영 환경변수 `INDEXNOW_KEY=d8480180f2798f02382139f1dfd53952`로 설정해야 동작. IndexNow 키는 원래 공개되는 값(비밀 아님)
- 대상: **공개 중 + 대기열에서 공개(published_at 있음) + noindex 아님 + 아직 알리지 않음**. 관리자가 직접 만든 기존 페이지는 보내지 않음
- 기록: `indexnow_page_status`(페이지별 알린 시각, landing_pages에 컬럼을 두면 updated_at 트리거 때문에 sitemap lastmod가 거짓으로 바뀌어 별도 테이블), `indexnow_submissions`(시도별 성공/실패·응답 코드·오류)
- 실패해도 공개에는 영향 없음. 실패한 페이지는 기록되지 않으므로 다음 전송 때 자동으로 다시 대상(재시도)
- 언제 보내나
  1. 관리자 대시보드(`/admin`) 접속 시 — 응답 뒤(`after`) 자동 전송. 최근 10분 안에 실패했으면 쉬어 감
  2. 설정 화면 '지금 1회 실행'으로 공개된 페이지가 있으면 응답 뒤 전송, '지금 보내기' 버튼
  3. `/api/indexnow`(GET/POST): 로그인 사용자, 또는 `Authorization: Bearer <CRON_SECRET>`. `vercel.json`에 Vercel Cron `10 0 * * *`(매일 00:10 UTC, 자동 공개 10분 뒤) 추가 — Vercel Cron은 CRON_SECRET이 설정돼 있으면 이 헤더를 붙여 부른다
- **이 프로젝트는 Service Role Key를 쓰지 않으므로**, 로그인 세션 없는 예약 호출은 anon 키로 SECURITY DEFINER 함수 2개(`indexnow_pending_pages`, `indexnow_record_submission`)만 부른다. 함수 안에서 호출자 확인: authenticated면 허용, 아니면 넘겨받은 비밀값이 **Supabase Vault의 `indexnow_cron_secret`**과 같을 때만 허용. 테이블 직접 읽기·쓰기는 anon에게 막혀 있음
  - 운영 설정: 환경변수 `CRON_SECRET`(16자 이상 무작위) + 같은 값을 Vault에 등록(`supabase/manual/015_cron_schedule.sql` [B]). 둘 중 하나라도 없으면 예약 호출만 실패하고, 대시보드 접속·설정 화면 전송은 그대로 동작
- 사이트 주소(`NEXT_PUBLIC_SITE_URL`)가 https 공개 주소가 아니면(localhost, http) 보내지 않음
- `.env.local.example`에 `INDEXNOW_KEY`, `CRON_SECRET` 이름 추가

### sitemap

- 각 페이지 `lastmod` = `published_at`과 `updated_at` 중 최신(둘 다 없으면 created_at). `lib/sitemap-lastmod.ts`

### 검증

- `npm test` ✅ 18개 파일, 407개 테스트(이전 380 + 신규 27)
  - `tests/auto-publish-indexnow.db.test.ts` (20, PGlite + migration 001~015): 015 제약·컬럼·롤백 후 재적용, 래퍼(꺼짐이면 아무것도 안 함, 하루 개수 반영·trigger 기록·같은 날 차단, 지금 실행은 꺼져 있어도 실행, postgres 실행 가능·anon/service_role 거부), **cron 등록 SQL을 흉내 낸 cron 스키마에 두 번 실행 → 작업 1개, 등록 명령 실행 시 공개**, 앱 설정·지금 실행·실행 기록, 키 파일 이름=내용, 전송 대상 선정, 공식 형식 POST(가짜 fetch), 202 성공, 429·네트워크 오류 후 재시도, 설정 없음/localhost 미전송, 자동 전송 10분 쉬기, 상태 조회, anon 비밀값 확인(Vault), `/api/indexnow` 401·CRON_SECRET·로그인·502
  - `tests/sitemap-lastmod.test.ts` (6): 최신 시각 선택, 공개 시각 없음, 날짜 아닌 값, sitemap 항목별 lastmod
  - `bulk-components.test.tsx`: 자동 공개 설정 카드 렌더링
- 일부러 망가뜨려서 테스트가 잡는지 확인(확인 후 원복): 래퍼가 enabled 무시 → 1개 실패, daily_limit 대신 50 → 4개, noindex도 대상 → 7개, 실패해도 완료 표시 → 2개, anon 비밀값 없이 허용 → 1개, 202를 실패로 → 1개, 자동 전송 쿨다운 제거 → 1개, lastmod를 updated_at만 → 2개
- `npx tsc --noEmit` ✅ / `npx eslint` ✅ / `npx next build` ✅(빌드 로그 "Dynamic server usage"는 기존과 같음)
- 외부 호출 없음(IndexNow는 가짜 fetch), 운영 DB 접속 없음

### 알아둘 것

- 운영 적용 순서: migration **013 → 014 → 015** → (pg_cron 켜고) `supabase/manual/015_cron_schedule.sql` [A] → 환경변수 `INDEXNOW_KEY`·`CRON_SECRET` + Vault [B] → 코드 배포 → 설정에서 자동 공개 켜기
- 실제 pg_cron·Vault·Vercel Cron·네이버 IndexNow 응답은 아직 확인하지 않음(PGlite에는 pg_cron이 없어 cron 스키마를 흉내 내 SQL만 확인). 운영 적용 후 첫 실행 결과를 설정 화면의 실행 기록·IndexNow 기록으로 확인할 것
- 백업 파일에는 IndexNow 기록과 실행 기록을 넣지 않았다(복구 후에는 공개 페이지가 다시 "아직 알리지 않음"이 되어 한 번 더 전송될 수 있음 — 검색엔진에 문제 되지 않는 수준)

## 다음 단계

1. 7단계: SEO 강화 + 오늘 공개 목록
2. 운영 적용 전: 테스트 DB(또는 로컬 Supabase)에서 실제 PostgREST·브라우저로 rpc 호출·업로드·붙여넣기·백업/복구·1,000행 넘는 데이터 재확인
3. 마지막 단계(8단계): Next.js 보안 업데이트, 운영 DB에 013 → 014 → 015 적용 + cron 등록(사용자 지시 후) → 코드 배포
