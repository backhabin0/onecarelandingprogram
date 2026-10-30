# HANDOFF — feature/bulk-publish

마지막 업데이트: 2026-10-27 (feature/photos 운영 배포 완료: migration 019 적용·main `a9d20a4`)

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

## 7단계 — 지역 SEO 강화 + 오늘 공개 목록 ✅ 완료 (운영 미적용)

목표: 지역 키워드 검색 노출에 유리하게, 네이버·구글 공식 가이드 범위 안에서(키워드 억지 반복·숨긴 텍스트·지어낸 정보 없이). 검색엔진·운영 DB 실제 접속 없음.

### 관리자 화면

- 메뉴 이름 "대량 등록" → **"AI 대량 생성"**(URL `/admin/bulk` 그대로). 화면 제목·안내 문구도 함께 변경
- 공개 대기열 화면에 **'공개된 주소'** 카드: 한국 날짜 선택(기본 오늘, 미래 불가), 그날 공개되어 지금도 공개 중인 페이지 주소를 한 줄에 하나, '전체 복사'(네이버 서치어드바이저 웹 페이지 수집 요청에 붙여넣기)
- 설정 "매일 자동 공개" 카드에 **'내용이 적은 페이지는 검색 제외(noindex)로 공개'** 체크(기본 꺼짐) — 켜면 이후 공개되는 얇은 페이지부터 noindex
- 대기열 항목 수정 폼에 새 칸 5개

### 양식·업로드

- 새 칸(양식 **맨 뒤**에 추가): 시/군(예: 군포시), city_slug, 대표 사진 URL, 사진 설명(alt), 현장 사례(손님이 직접 작성)
  - 맨 뒤에 둔 이유: 예전 20칸 양식 파일과 머리글 없이 붙여넣은 예전 표도 앞 20칸이 같은 순서로 그대로 읽힘(테스트로 확인)
- 프롬프트 만들기: 새 칸은 **[비워 둘 칸 — 채우지 마세요]**로 안내하고 입력 표에서도 빈칸
- 검사 추가
  - 오류: 시/군·city_slug는 함께 입력(또는 둘 다 비움), city_slug 형식, 대표 사진 URL은 http(s), 글자 수(지역·키워드·시/군 50, 사진 URL 500, alt 200, 현장 사례 2000)
  - 경고(저장 가능): **키워드 과다 반복**(대표+소개 문구에 같은 키워드 5번 초과), **얇은 페이지**(소개 문구 200자 미만 + 사진·현장 사례 모두 없음)
- 기준값은 `lib/landing-page-validation.ts`의 `LOCAL_SEO_MAX_LENGTH`, `THIN_DESCRIPTION_MIN_LENGTH`(200), `KEYWORD_REPEAT_LIMIT`(5)

### migration 016 (`supabase/migrations/016_local_seo_fields.sql`, 되돌리기 `supabase/rollback/016_down.sql`)

- `landing_pages`: region, keyword, city, city_slug, main_image_alt, case_study 추가(모두 nullable, 기존 행 null) + 시/군 조회용 부분 인덱스
- `landing_page_queue`: city, city_slug, main_image_url, main_image_alt, case_study 추가 + 지역·키워드 50자 제약(`not valid` — 기존 행은 검사 안 함)
- `auto_publish_settings.noindex_thin_pages`(기본 false)
- `publish_queued_landing_pages` 다시 정의: 위 칸을 공개 페이지로 복사, 옵션이 켜져 있으면 얇은 페이지(소개 200자 미만 + 사진·사례 없음)의 SEO 설정을 noindex로. 나머지 동작(오래된 순, 같은 KST 날짜 차단, slug 충돌 행만 failed)은 013과 같음
- 016_down은 013의 공개 함수로 되돌리고 칸을 지움

### 공개 페이지 SEO(템플릿 A·B 공통)

- **제목·H1**: 지역·키워드가 있는 페이지는 "지역 키워드"가 앞쪽에 오도록 다듬음(`buildHeadline` — 이미 들어 있으면 그대로, 빠진 것만 앞에 붙여 같은 말 반복 없음). H1은 페이지에 1개. 자동 SEO 제목도 같은 머리말 + " | 업체명". 관리자가 SEO 제목을 직접 넣었으면 그대로 사용
- meta description·canonical·OG는 기존 resolver 그대로(페이지마다 고유한 소개 문구 기반)
- **구조화 데이터**: WebPage, LocalBusiness/Organization(+ **areaServed**: SEO 설정의 서비스 지역 글자, 없으면 시/군+지역 AdministrativeArea, 둘 다 없으면 생략), FAQPage(화면 FAQ와 같음), **BreadcrumbList**(시/군 모음 › 페이지 — 화면 상단에도 같은 경로 표시. 처음엔 "홈"으로 시작했으나 8-3에서 뺌: 사이트 루트가 관리자 로그인으로 넘어가기 때문)
- **이미지**: next/image(fill, sizes, 첫 화면 이미지는 `fetchPriority="high"` — Next 16에서 `priority`는 deprecated). alt는 입력값 → "지역 키워드 현장" → "업체명 대표 이미지". Supabase Storage 공개 경로만 최적화(`next.config.ts` `images.remotePatterns`, `maximumRedirects: 0`), 엑셀로 받은 외부 주소는 원본(unoptimized). 사진이 없거나 깨지면 상자째 렌더링하지 않음. 템플릿 B 배경 사진도 alt 부여
- **현장 사례**가 있으면 '현장 사례' 섹션
- **내부 링크**(페이지 하단): 같은 지역 다른 서비스(같은 시/군·같은 지역·다른 키워드, 최대 5, 가나다순), 근처 지역 같은 서비스(같은 시/군·같은 키워드·다른 지역, 최대 5 — 위치 정보가 없어 지역 가나다순에서 현재 지역 다음부터 돌아가며 골라 링크가 고르게 퍼지게), 지역 모음 링크. 공개+noindex 아닌 페이지만. 미리보기에서는 출력 안 함
- 지역·키워드가 없는 기존(직접 만든) 페이지는 제목·H1·구조화 데이터가 예전과 같음

### 지역 모음 페이지 `/area/{city_slug}`

- 그 시/군의 공개+noindex 아닌 페이지를 키워드별로 묶어 링크(지역 가나다순). 1개도 없으면 404 + 색인 제외 메타데이터. city_slug 형식이 틀려도 404
- H1 "{시/군} 지역 안내", 메타 제목 "{시/군} {키워드들} 지역 안내 | 업체명"(업체명이 하나일 때), canonical, ItemList + BreadcrumbList JSON-LD
- `lib/slug.ts`에 예약어 `area` 추가(랜딩페이지 slug로 쓸 수 없음)
- sitemap에 포함(공개 페이지가 있는 시/군만, lastmod = 그 시/군 페이지 중 최신)

### 백업 형식 version 3

- 랜딩페이지·대기열 새 칸 포함. version 1·2 파일도 계속 읽고, 파일에 없는 칸은 복구 때 쓰지 않아 현재 값 유지

### 검증

- `npm test` ✅ 20개 파일, 453개 테스트(이전 407 + 신규 46)
  - `tests/local-seo.test.tsx` (30): 머리말 5가지, 자동 SEO 제목, alt 자동 생성, 내부 링크 선정 규칙(같은 지역: 시/군 같아야 함·자기 자신·noindex·키워드 중복 제외·최대 5 / 근처 지역: 회전 선택·다른 키워드·다른 시/군·noindex 제외 / 모음 링크), DB 조회(공개만·noindex 제외), 지역 모음 묶기, `/area/gunpo` 렌더링(H1 1개·링크·ItemList·BreadcrumbList·메타데이터)과 404, **템플릿 A/B H1 1개**, 사진 alt, 사진 없을 때, 현장 사례 섹션, 경로·내부 링크 표시, **구조화 데이터 JSON 파싱 유효성**과 내용(areaServed·FAQ·BreadcrumbList 위치), 미리보기 미출력, `</script>` 이스케이프, KST 경계, 이미지 최적화 기준
  - `tests/local-seo-upload.db.test.ts` (12): 새 칸 파싱, **구 양식·머리글 없는 붙여넣기 호환**, 머리글 이름 정규화, 새 검사(시/군 짝·city_slug·사진 URL·글자 수), 키워드 과다 반복 경계(5번 OK·6번 경고), 얇은 페이지 경계, 프롬프트 빈칸 안내, PGlite: 공개 함수 새 칸 복사, 얇은 페이지 noindex 옵션(꺼짐/켜짐), 대기열 50자 제약, **날짜별 공개 주소 KST 경계**(14:59:59.999Z/15:00Z), sitemap 지역 모음
  - 기존 테스트 수정: 메뉴 이름, 백업 v3 픽스처 + v2 호환 테스트, 얇은 페이지 경고가 붙는 검사 테스트 픽스처(대표 사진 추가)
  - `bulk-components.test.tsx`: 공개된 주소 카드 렌더링
- 일부러 망가뜨려서 테스트가 잡는지 확인(확인 후 원복): 근처 지역 회전 제거 → 1개 실패, noindex 후보 허용 → 3개, 같은 지역에서 시/군 무시 → 1개, 모음에 noindex 포함 → 2개, KST 오프셋 8시간 → 3개, 얇은 페이지 사진 무시 → 1개, 016 얇은 페이지 옵션 무시 → 1개, 016 현장 사례 복사 누락 → 1개, BreadcrumbList 시/군 누락 → 1개
- `npx tsc --noEmit` ✅ / `npx eslint` ✅ / `npx next build` ✅(`/area/[citySlug]` 동적 라우트 생성, "Dynamic server usage" 로그는 기존과 같음)

### 알아둘 것

- 운영 적용 순서에 016 추가: 013 → 014 → 015 → **016** → (cron 등록) → 코드 배포. 016 없이 코드가 나가면 공개 페이지 자체는 열리지만(새 칸이 없을 뿐) **sitemap(새 칸을 골라 조회)이 빈 목록**이 되고, 지역 모음·내부 링크 조회와 대기열 저장(새 칸 insert)이 실패함 — 반드시 016 먼저
- 실제 브라우저 확인은 아직 안 함(next/image 실제 최적화 응답, 외부 사진 주소 표시, 복사 버튼). 네이버·구글 리치 결과 테스트 도구로 구조화 데이터 확인도 운영 적용 후 할 것
- 관리자 '새 페이지 만들기'·'수정' 폼에는 새 칸(시/군·지역·키워드·alt·현장 사례)이 없다 — 대기열에서 공개된 페이지만 값이 있음. 직접 만든 페이지에도 필요하면 다음에 추가
- "근처 지역"은 실제 거리가 아니라 같은 시/군 안의 다른 지역이다(위치 좌표가 없음)

## 8단계 — 8-1 운영 현황 확인 ✅ (2026-10-23, 운영 DB 읽기 전용 조회)

### 운영 DB(`jxatzdldyawjxgeepdiz`) count 조회

`npx supabase db query --linked --project-ref jxatzdldyawjxgeepdiz "<SELECT count…>"`(`supabase link` 없이, SELECT 한 문장만 실행)

| 항목 | 값 |
| --- | --- |
| landing_pages 전체 | **1,047** |
| status = 'public' | **1,047** |
| seo_noindex = true(SEO 설정 전체) | 0 |
| 공개 중 + noindex | 0 |
| → sitemap에 들어가야 할 페이지 | **1,047** |

- **주의 — CLI가 로그인 역할을 만들었을 수 있음:** 위 명령 실행 중 CLI가 "Initialising login role..."을 출력했다. Supabase CLI가 Management API로 DB에 접속하기 위해 **임시 로그인 역할(DB 계정)을 만들거나 갱신**한 것으로 보인다. 테이블 데이터·스키마는 바꾸지 않았고 실행한 SQL은 SELECT 한 문장뿐이지만, "운영 DB 쓰기 금지"에 비춰 보고해 둔다. 이후 추가 조회는 하지 않았다. 확인하려면 Supabase Dashboard > Database > Roles에서 `cli_login_` 로 시작하는 역할이 있는지 본다(지우거나 바꾸는 것은 사용자 판단).

### 운영 sitemap(https://onecarepage.co.kr/sitemap.xml, GET)

- HTTP 200, `<url>` **1,000개**(중복 없음). lastmod 범위 2026-09-12 ~ 2026-10-22

### 결론: 운영에서 1,000개 잘림이 실제로 일어나고 있다

- sitemap에 있어야 할 페이지 1,047개 중 **1,000개만** 들어 있다 → **47개 누락**
- 운영 코드(main)는 sitemap 조회에 1,000행 제한 대응이 없고 created_at 최신순이라, **가장 오래된 47개 페이지**가 빠져 있다(sitemap의 가장 이른 lastmod가 2026-09-12)
- 이 브랜치의 1단계 수정(1,000행씩 끝까지 읽기)이 배포되면 해결된다. 단, 이 브랜치의 sitemap 조회는 016 칸(published_at·region·city 등)도 함께 고르므로 **migration 013~016 적용 후 배포**해야 한다(먼저 배포하면 sitemap이 빈 목록이 됨)
- 같은 원인으로 운영의 관리자 화면 숫자·통계·상담 CSV·백업도 1,000행 근처에서 잘리고 있을 가능성이 높다(1단계 변경 내용 참고)

### 예시 파일(`docs/samples/`, `npm run samples`로 다시 생성)

- `onecare-bulk-upload-template.xlsx`: 엑셀 양식(머리글 25칸 + 예시 1행)
- `prompt-3regions-x-2keywords.txt`: 프롬프트 만들기 결과(산본동·금정동·수리동 × 배관 수리·하수구 막힘 = 6행)
- `README.md`: 예시 입력값과 사용 순서

## 8단계 — 8-2 Next.js 보안 업데이트 ✅ (2026-10-23, 운영 DB 접속 없음)

### next critical 경고 원인(GitHub 보안 공지 기준)

운영·브랜치 모두 **next 16.3.4**였고, 아래 공지에 해당했다. 3개는 16.4.1에서 처음 고쳐졌다(16.4.1은 이 3건만 고친 보안 전용 릴리스).

| 공지 | 위험도 | 내용 | 영향 범위 | 고쳐진 버전 |
| --- | --- | --- | --- | --- |
| GHSA-2464-fhr4-w9xw | critical | 이미지 최적화(SVG) 경로의 원격 코드 실행 — 의존 라이브러리 sharp(librsvg) 결함, glibc Linux | ~16.4.0 | **16.4.1**(sharp ≥ 0.35.5) |
| GHSA-673q-mjm6-r5xr | critical | `use cache`가 typed array를 돌려줄 때 원격 코드 실행(Cache Components 사용 앱) | 16.0.0~16.4.0 | **16.4.1** |
| GHSA-p3m5-59mp-jv5r | high | Server Action이 있는 App Router 앱 CPU 고갈 서비스 거부 | ~16.4.0 | **16.4.1** |
| GHSA-vcvr-r3jv-pc5j | critical | next/og ImageResponse 원격 코드 실행 | 16.2.0~16.3.5 | 16.3.6 |
| GHSA-cjq9-62q9-8jv4 외 7건 | high~low | 이미지 최적화 SSRF, 캐시 오염·누출, 메타데이터 이미지 정보 노출 등 | ~16.3.7 | 16.3.8 |

- 이 앱에 실제로 해당하는 것(코드 검색으로 확인):
  - **GHSA-p3m5(Server Action DoS)**: 운영 main·이 브랜치 모두 Server Action을 쓰므로 **직접 해당**(운영도 지금 위험 — 배포로 해결)
  - **GHSA-2464(이미지 최적화)**: 이 브랜치는 7단계부터 next/image와 Supabase Storage remotePatterns를 쓰므로 해당. 운영 main은 next/image를 쓰지 않고 원격 이미지 허용 설정도 없어 노출이 작지만, `/_next/image` 경로 자체는 있으므로 업데이트가 안전
  - GHSA-673q(`use cache`)·GHSA-vcvr(next/og): 이 앱은 `use cache`·Cache Components·next/og를 쓰지 않아 **해당 없음**(그래도 같은 버전에서 함께 해소)

### 업데이트

- `next` 16.3.4 → **16.4.1**, `eslint-config-next` 16.3.4 → **16.4.1**(짝 패키지, 정확한 버전 고정). sharp는 next를 따라 **0.35.5**로 올라감. 같은 메이저(16) 안의 최소 안전 버전이라 메이저 업그레이드 필요 없음
  - 16.4.1은 배포된 지 9일(2026-10-14)이라 평소 쓰는 "2주 지난 버전" 기준보다 새것이지만, 보안 패치가 들어간 가장 낮은 버전이 16.4.1이라 이것을 골랐다(16.4.2는 보안 수정 없는 Turbopack·문서 백포트)
- 16.3 → 16.4 변경 중 확인한 것(16.4.0 릴리스 노트): strict route matching 기본 켜짐·라우트와 맞지 않는 페이지 오류·인식 못 한 Server Action은 클라이언트 오류(4xx)로 응답·AVIF 최적화 재활성화·`unstable_` 접두사 제거(navigation/prefetch — 이 앱은 사용 안 함)
- **결과: 바뀐 동작 없음** — `npm test` 453개 ✅, `npx tsc --noEmit` ✅, `npx eslint` ✅, `npx next build` ✅. 빌드 라우트 목록(29개)이 업데이트 전과 같고, 빌드 로그도 기존 "Dynamic server usage" 안내만 있음

### 남은 npm audit 경고(10건 → 운영 번들 포함은 1건)

| 패키지 | 위험도 | 들어오는 경로 | 운영 영향 | 판단 |
| --- | --- | --- | --- | --- |
| source-map-js 1.2.1 | high(DoS) | postcss·tailwind(빌드 때 CSS 처리) | **낮음** — 빌드 때 우리 CSS의 source map만 읽음(외부 입력 없음). 런타임 요청 처리에 쓰이지 않음 | lockfile만 바뀌는 `npm audit fix`로 1.2.2 가능 — **다음에 고치기 권장**(쉬움, 위험 낮음) |
| tinypool 1.1.1 | critical(프로토타입 오염 → RCE) | vitest 3.2.4(테스트 도구) | **없음** — 개발 PC의 테스트 실행에만 사용, 운영 배포에 포함 안 됨. 공격하려면 테스트 프로세스 옵션을 조작해야 함 | 고치려면 vitest 4(메이저) 필요 → **지금은 안 고침**, 나중에 vitest 4 업그레이드 때 |
| vitest 3.2.4 / @vitest/mocker | critical·moderate | 테스트 도구 | 없음 — critical(GHSA-5xrq)은 vitest **UI 서버**를 켰을 때만 해당(이 프로젝트는 UI 안 씀). mocker 2건은 4.1.11+에서만 수정 | `npm audit fix`로 3.2.7까지는 가능(UI 서버 건 해결), 나머지는 vitest 4 필요 |
| brace-expansion 1.1.18 / 5.0.9 | high(DoS) | eslint·typescript-eslint의 minimatch | 없음 — 개발 PC에서 우리 파일에만 lint | `npm audit fix`로 1.1.21 / 5.0.12 가능(lockfile만) |
| braces·micromatch·fast-glob·@next/eslint-plugin-next·eslint-config-next | high(DoS) | eslint-config-next 16.4.1 | 없음 — lint 전용 | npm이 제안하는 수정이 eslint-config-next **14로 내리기**(메이저 다운그레이드)라 **하지 않음**. braces는 아직 고쳐진 버전이 없음(≤3.0.3 전부 해당) |

- 정리: **운영 서버에 영향 있는 critical/high는 next 업데이트로 모두 해소**. 남은 것은 빌드 도구(source-map-js) 1건과 개발 도구(vitest·eslint)뿐
- 권장(별도 지시 시): `npm audit fix`(메이저 변경 없음 — source-map-js 1.2.2, brace-expansion, vitest 3.2.7)를 한 번 적용하고 테스트 재확인. vitest 4 업그레이드는 운영 적용이 끝난 뒤

## 8단계 — 8-3 운영 DB 백업 + migration 013~016 적용 ✅ (2026-10-23)

방식: `supabase db push`·`migration repair`·001~012 재적용은 하지 않았다(운영에는 migration 기록 테이블이 없음). 파일 하나씩, 사용자 승인 후 `npx supabase db query --linked --project-ref jxatzdldyawjxgeepdiz -f <파일>`로 실행. 각 파일은 원본 그대로 앞뒤에 `begin;`/`commit;`만 붙여 **한 트랜잭션**으로 실행(중간 오류 시 전부 취소되도록).

### 사전 점검(읽기 전용)

| 항목 | 결과 |
| --- | --- |
| Postgres | 17.6 |
| 013~016이 만들 테이블·칸·함수 | 없음(013이 쓰는 기존 `set_updated_at`만 있음) |
| 확장 | pgcrypto 1.3·supabase_vault 0.3.1 설치됨, pg_cron 1.6.4 사용 가능(미설치) |
| migration 기록(`supabase_migrations.schema_migrations`) | **없음** |
| slug='area' 페이지 | 0(새 예약어와 충돌 없음) |
| 역할 | `cli_login_postgres` 있음(CLI 관리 API 접속용 임시 로그인 역할 — `db query --linked`를 쓸 때마다 "Initialising login role..."로 갱신됨) |

### 백업

| 테이블 | DB 행 수 | 저장 행 수 | 일치 |
| --- | --- | --- | --- |
| landing_pages | 1,047 | 1,047 | ✅(id·slug 중복 없음) |
| landing_page_events | 572 | 572 | ✅ |
| landing_page_faqs | 12 | 12 | ✅ |
| consultation_requests | 7 | 7 | ✅ |
| landing_page_seo_settings | 6 | 6 | ✅ |
| site_verification_settings | 1 | 1 | ✅ |

- DB 덤프: `C:\Users\user\Documents\onecare-backup\2026-10-23_1853\`(저장소 밖) — `data\<테이블>.json`(200행씩 SELECT로 읽어 합침), `counts.json`, `schema.json`(칸 52·제약 24·인덱스 14·트리거 3·함수 1·RLS 정책 21(public+storage)·Storage 버킷 1·확장 5)
- 관리자 JSON 백업: `C:\Users\user\Downloads\onecare-backup-20261023T095140Z.json`(4.2MB, version 1) — 랜딩 1,047 / SEO 6 / FAQ 12 / 상담 7 / 이벤트 572(덤프와 같음, 1,000행 잘림 없음)

### 적용 결과

| 순서 | 파일 | 결과 | 확인한 내용(읽기 전용 SELECT) | 사이트 확인(GET) | 관리자 대시보드(사용자) |
| --- | --- | --- | --- | --- | --- |
| 1 | 013_publish_queue.sql | ✅ exit 0 | 테이블 3개(queue·auto_publish_settings·publish_runs) RLS 켜짐·authenticated 정책 6개, `landing_pages.published_at`(기존 행 모두 null), 함수 2개(공개 함수 실행 권한 authenticated·postgres), 설정 1행(꺼짐·50) | 정상 | 정상 |
| 2 | 014_bulk_upload_similarity_settings.sql | ✅ exit 0 | 유사도 기준 0.6/0.8 + check 제약 | 정상 | 정상 |
| 3 | 015_auto_publish_indexnow.sql | ✅ exit 0 | 하루 개수 1~100, `publish_runs.trigger`, 함수 4개(`run_auto_publish` authenticated·postgres / `indexnow_caller_allowed` postgres만 / 조회·기록 함수 anon·authenticated — 함수 안에서 Vault 비밀값 확인, 아직 미등록이라 anon 호출은 모두 거절), IndexNow 테이블 2개 RLS·authenticated 조회 정책. pg_cron 미설치·미등록(계획대로) | 정상 | 정상 |
| 4 | 016_local_seo_fields.sql | ✅ exit 0 | 랜딩 새 칸 6개(기존 1,047행 모두 null), 대기열 새 칸 5개, 지역·키워드 50자 제약(not valid), 시/군 부분 인덱스, `noindex_thin_pages`=false, 공개 함수가 새 칸·얇은 페이지 옵션 반영 | 정상 | 정상 |

- 사이트 확인(매 단계 같음): 홈 `/` 307 → `/admin`(main 코드의 원래 동작), 랜딩 1개 200·제목 정상, `/login` 200, `/admin` 307 → `/login`, `sitemap.xml` 200·1,000개(배포 전이라 main의 1,000개 잘림 그대로)
- 매 단계 데이터 그대로: 랜딩 1,047(공개 1,047) / SEO 6 / FAQ 12 / 상담 7, 대기열·실행 기록·IndexNow 기록 0
- 되돌리기 SQL은 쓰지 않음(오류 없음)
- 지금 상태: **운영 DB는 이 브랜치 코드가 필요로 하는 구조를 모두 갖춤**, 운영 코드는 아직 main(배포 안 함)

### 배포 전 수정: 경로에서 "홈" 제거

- 이유: 사이트 루트(`/`)가 관리자 로그인으로 넘어가는 주소라(운영 확인 중 발견) 경로 표시·BreadcrumbList에 "홈"이 들어가면 검색엔진에 좋지 않음
- 랜딩 페이지(템플릿 A·B): 경로가 **"시/군 › 페이지"**로 시작(화면·BreadcrumbList 같음). 시/군이 없으면 항목이 1개라 경로 표시·BreadcrumbList 모두 생략(Google은 BreadcrumbList에 2개 이상 요구)
- 지역 모음 페이지(`/area/{city_slug}`): "홈"을 빼면 경로가 "시/군" 1개뿐이라 경로 표시·BreadcrumbList를 넣지 않음(ItemList는 그대로)
- 테스트: 템플릿 A/B 경로 항목이 `["군포시", "페이지"]`, 사이트 루트 링크·"홈" 없음, BreadcrumbList 위치 1·2, 시/군 없는 페이지는 생략, 모음 페이지에 경로·BreadcrumbList 없음. "홈"을 다시 넣으면 5개 실패하는 것 확인
- `npm test` 457개 ✅ / `npx tsc --noEmit` ✅ / `npx eslint` ✅ / `npx next build` ✅

## 8단계 — 8-4 운영 배포 ✅ (2026-10-23)

| 순서 | 작업 | 결과 |
| --- | --- | --- |
| 1 | 배포 전 확인(읽기) | Vercel 프로젝트 `onecarelandingprogram`(`prj_W8mBWxnuFo0HqIx4di37MunPiTsS`, 팀 `habin-s-projects`) ↔ GitHub `backhabin0/onecarelandingprogram` **main 자동 배포**(createDeployments enabled). 배포 전 운영: **`dpl_A76SdL2cfJ4AnQthqyLgKUdxHrcv`**(main `4ddf124`, 2026-09-13) ← 되돌리기용 |
| 2 | Vercel Production 환경변수 | `INDEXNOW_KEY`(Config, public 키 파일 값과 같음), `CRON_SECRET`(Secret, 영문·숫자 48자, 확인용 sha256 앞 12자 `7de216bd6c0c`) — 값은 어디에도 출력·저장 안 함 |
| 3 | Supabase Vault | `vault.create_secret(<CRON_SECRET>, 'indexnow_cron_secret', ...)` — DB 안에서 sha256끼리 비교해 같은 값 확인 |
| 4 | PR·머지 | [PR #1](https://github.com/backhabin0/onecarelandingprogram/pull/1)(커밋 18·파일 126, 미리보기 빌드 성공) → 사용자 "머지해" → merge commit **`3664625`** → 자동 배포 **`dpl_26sZGXgMipT3h8BqtphNzbZ6vPRi`** READY(약 1분) |
| 5 | 배포 직후 확인(GET) | 아래 표 — 모두 정상 |

| 확인 | 결과 |
| --- | --- |
| sitemap.xml | 200, **1,047개**(중복 없음, 모두 lastmod) — 1,000개 잘림 해소. 기존 페이지는 시/군이 비어 있어 허브 0개가 정상 |
| 랜딩 3개(sitemap 처음·중간·끝) | 모두 200, H1 1개, JSON-LD WebPage·LocalBusiness·FAQPage(모두 유효한 JSON), canonical 정상, index/follow. 시/군이 없어 경로 표시·BreadcrumbList 없음(정상), "홈"·사이트 루트 링크 없음 |
| `/area/gunpo` | 404(허브 0개라 정상) |
| `/d8480180f2798f02382139f1dfd53952.txt` | 200, 내용 = 키 |
| `/api/indexnow`(비밀값 없이) | 401(거절 — 검색엔진에 보내지 않음) |
| `/admin` / `/login` / `/` | 307 → /login / 200 / 307 → /admin |
| robots.txt | 200, Sitemap 줄 있음 |
| Vercel Cron | `/api/indexnow` `10 0 * * *` 등록됨(새 배포 기준) |

- **Vercel Cron(IndexNow)은 내일부터 매일 00:10 UTC(09:10 KST)에 실행됨**. 보내는 대상은 `published_at`이 있는(대기열로 공개된) 페이지뿐이라, 기존 1,047개는 `published_at`이 비어 있어 **보내지 않음** → 대기열로 처음 공개하기 전까지는 보낼 것이 0개
- pg_cron 켜기·매일 자동 공개 등록은 하지 않음(다음 단계)
- 되돌리기가 필요하면: Vercel에서 `dpl_A76SdL2cfJ4AnQthqyLgKUdxHrcv`로 promote(또는 `vercel rollback`). DB(013~016)는 추가만 했으므로 이전 코드와 함께 동작

## 8단계 — 8-5 pg_cron + 매일 자동 공개 작업 등록 ✅ (2026-10-23)

| 순서 | 작업 | 결과 |
| --- | --- | --- |
| 1 | pg_cron 켜기 | 공식 문서(supabase.com/docs/guides/cron/install) SQL을 한 트랜잭션으로 실행: `create extension if not exists pg_cron with schema pg_catalog;` + `grant usage on schema cron to postgres;` + `grant all privileges on all tables in schema cron to postgres;` → pg_cron **1.6.4**(pg_catalog), cron 스키마 생김, 작업 0개 |
| 2-1 | `015_cron_schedule.sql` 그대로 실행 | ❌ 오류 → 트랜잭션이라 **전부 취소**(바뀐 것 없음 확인). 원인: 이미 켜진 상태에서 `create extension if not exists pg_cron`을 다시 부르면 Supabase의 pg_cron 권한 이벤트 트리거가 다시 돌아 `revoke all on table cron.job from postgres`에서 `2BP01 dependent privileges exist` |
| 2-2 | create extension 줄만 빼고 [A] 실행(사용자 승인) | ✅ `cron.job` **1개**: jobid 1, `onecare-daily-auto-publish`, `0 0 * * *`(매일 09:00 KST), `select public.run_auto_publish(false)`, 실행 사용자 `postgres`, active |

- 자동 공개 설정은 **꺼짐 그대로**(하루 50개). 매일 09:00 KST에 작업이 돌지만 `run_auto_publish`가 꺼짐을 보고 `{"status":"disabled"}`만 돌려주고 아무것도 공개·기록하지 않음(실행 이력은 `cron.job_run_details`에 하루 1줄)
- CLI(`db query --linked`)의 접속 사용자는 `postgres`(superuser 아님)라 작업도 `postgres`로 등록됨
- `supabase/manual/015_cron_schedule.sql`: create extension 줄을 `with schema pg_catalog`로 바꾸고 "이미 켜져 있으면 이 줄은 빼고 실행" 안내 주석 추가(테스트도 맞춤)
- 시험 공개는 하지 않음 — 손님 실제 지역·키워드로 첫 묶음을 만들 때 시험(사용자 결정)
- 되돌리기: 작업 해제는 파일의 [C], pg_cron 끄기는 `drop extension pg_cron;`(작업도 함께 삭제)

### 기존 1,047개 IndexNow 전송 — **보내지 않음**(2026-10-23 사용자 결정: A안)

- 결정: 기존 페이지는 IndexNow로 보내지 않고, 1,047개 전부 들어간 sitemap(lastmod 포함)과 네이버 서치어드바이저 sitemap 제출·수집 요청(사용자)에 맡긴다. IndexNow는 앞으로 대기열로 공개되는 새 페이지만 자동 전송
- 검토했던 다른 안: B 일회성 스크립트로 나눠 전송(FAQ 권장 용도 밖, 품질 평가 위험), C 기존 행에 published_at을 써서 자동 전송(운영 DB 대량 변경, 비권장)

검토 근거:

- 한도: 요청 1번에 **최대 10,000개**(indexnow.org) → 1,047개는 한 번에 가능. 하루 한도는 공개되지 않음(검색엔진별·사이트별 기준), 많이 보내면 429
- 현재 코드로는 안 보내짐: 전송 대상은 `published_at`이 있는(대기열로 공개된) 페이지뿐인데 기존 1,047개는 모두 비어 있음. 전송 기록 0
- 기존 페이지 생성 시기: 2026-09 674개, 2026-10 373개(수정 시각도 같음) — 1~2개월 된 페이지
- 주의(indexnow.org FAQ): "예전 변경을 소급해서 보내는 용도가 아님"(오래된 내용은 lastmod 있는 sitemap 권장), 바뀌지 않은 주소 재전송 금지, 보낸 주소는 크롤링 할당량을 씀, 색인 보장 없음
- 엔드포인트는 네이버 서치어드바이저(`lib/indexnow.ts`), 네이버에 사이트 등록·소유 확인이 필요

## 8-2 이후 운영 적용 체크리스트

표시: 🙋 = 사용자가 직접 해야 함(대시보드 조작·결정·비밀값) / 🤖 = Claude가 할 수 있음(지시 후) / 🤝 = 함께

### A. 운영 적용 전 확인
- [x] 🙋 **테스트 환경: 따로 만들지 않음**(2026-10-23 결정). 운영 DB를 백업한 뒤 migration을 **하나씩** 적용하고 각 단계마다 확인한다(8-3에서 사용자가 지시). 실제 PostgREST·브라우저 확인은 운영 적용 후 D 단계에서 한다
  - 참고: 013~016은 모두 칸·테이블·함수를 **추가**만 하므로(기존 칸 삭제·이름 변경 없음, 015는 하루 개수 제약만 좁힘) 지금 운영 중인 main 코드는 migration 적용 후에도 그대로 동작한다 → migration을 먼저 하나씩 적용하고, 코드 배포는 마지막에
  - 위험 줄이기: migration 사이마다 운영 사이트·관리자 화면이 정상인지 확인, 문제 생기면 해당 `supabase/rollback/0NN_down.sql`로 되돌리기
- [x] 🤖 Next.js 보안 업데이트 — 8-2에서 완료(next 16.3.4 → 16.4.1)
- [x] 🙋 hanapage.co.kr(Supabase `mozfqmsjjarpsjhfjrql`)은 **이번 범위에서 제외**(2026-10-23 결정)

### B. 운영 DB 적용(사용자 지시 후에만)
- [x] 🙋 관리자 JSON 백업 다운로드 — `다운로드\onecare-backup-20261023T095140Z.json`(8-3, 1,000행 잘림 없이 전부 들어 있음)
- [x] 🤖 DB 덤프(SELECT만) — `C:\Users\user\Documents\onecare-backup\2026-10-23_1853\`(8-3)
- [x] 🤝 migration **013 → 014 → 015 → 016** 하나씩 적용 + 각 단계 확인(8-3, 아래 결과 표)
- [x] 🤖 **pg_cron 켜기**(1.6.4) → [A] 등록 → `cron.job`에 `onecare-daily-auto-publish`(`0 0 * * *`) 1개 확인(8-5)
- [x] 🤖 **CRON_SECRET**(48자) 만들기 → Vault `indexnow_cron_secret` 등록(8-4, 값은 출력·저장 안 함)

### C. Vercel 환경변수·배포
- [x] 🤖 Vercel Production 환경변수 `INDEXNOW_KEY`·`CRON_SECRET` 추가(8-4). `NEXT_PUBLIC_SITE_URL`은 있음(값은 확인 안 함 — canonical이 `https://onecarepage.co.kr/...`로 나와 정상)
- [x] 🤖 PR #1 → 🙋 머지 승인 → 자동 배포 `dpl_26sZGXgMipT3h8BqtphNzbZ6vPRi`(8-4)
- [x] 🤖 Vercel Cron `/api/indexnow`(`10 0 * * *`) 등록 확인(API로, 8-4)

### D. 배포 직후 확인
- [x] 🤖 sitemap.xml 1,047개(허브 0개 — 기존 페이지 시/군 없음, 정상)(8-4)
- [ ] 🤝 관리자 화면: 대시보드 숫자(1,047), 랜딩 목록 페이지 나눔, AI 대량 생성(양식 다운로드·붙여넣기 검사), 공개 대기열, 설정(유사도 기준·자동 공개·IndexNow 상태)
- [x] 🤖 랜딩 3개 H1·구조화 데이터·canonical 확인(8-4)
- [ ] 🙋 (선택) Google 리치 결과 테스트·네이버 서치어드바이저 웹 페이지 최적화 검사 — 기존 페이지는 지역·키워드 칸이 없으므로 예전과 같게 보이는 것이 정상
- [x] 🤖 IndexNow 키 파일 200·내용 일치(8-4)
- [ ] 🙋 네이버 서치어드바이저에 사이트가 등록·소유 확인되어 있는지, IndexNow 사용 조건 확인 → 설정 화면 '지금 보내기'로 첫 전송, 결과 기록 확인

### E. 자동 공개 시작
- [ ] 🙋 대기열에 테스트용 몇 개를 ready로 넣고 설정 > '지금 1회 실행'으로 공개 → 공개 페이지·IndexNow 기록·'공개된 주소' 확인
- [ ] 🙋 **자동 공개 켜기**와 하루 개수 결정(기본 꺼짐, 50개) / 얇은 페이지 noindex 옵션 여부 결정(기본 꺼짐)
- [ ] 🙋 다음 날 09:00(KST) 이후 설정 화면 실행 기록·IndexNow 기록 확인

### F. 마무리
- [ ] 🤖 관리자용 사용 설명서(양식 작성법, 프롬프트 사용법, 검사 결과 읽는 법, 대기열·자동 공개·공개된 주소 사용법)
- [ ] 🤝 운영 확인이 끝난 뒤 이 체크리스트와 계획 문서를 완료로 갱신

## 다음 단계

1. 네이버 서치어드바이저 사이트 등록·소유 확인, sitemap(`https://onecarepage.co.kr/sitemap.xml`) 제출·수집 요청(🙋) — 기존 1,047개는 IndexNow로 보내지 않기로 함
2. 손님 실제 지역·키워드로 첫 묶음 → 대기열 → '지금 1회 실행'으로 시험 공개(E) → 자동 공개 켜기 결정 → F 사용 설명서
3. (선택) 남은 npm audit 중 메이저 변경 없는 것(`npm audit fix`) 정리

## SEO·AEO·GEO 다시 하기 — `feature/seo-geo` (2026-10-25, 운영 DB 읽기만·배포 안 함)

`feature/bulk-publish`(5ea2e19) 위에서 새 브랜치로 작업. 운영 DB는 SELECT만 실행했다(`db query --linked`, 실행할 때마다 `cli_login_postgres` 갱신은 이전과 같음).

### 운영 확인으로 알게 된 것(2026-10-25)

- **10-23 21:38 KST에 대기열 10개가 '지금 1회 실행'(manual)으로 공개됨**: 모두 200 응답, sitemap 포함, IndexNow 200 성공 1회(10개). 위 8-5의 "시험 공개는 하지 않음"과 다름
- 기존 1,047개 페이지는 `business_name`·`address` 칸에 제목형 문구가 들어 있음(업체명 1,023가지, 주소 칸에 slug 문자열이나 문장). 주소로 보이는 값은 1,011개 중 2개
- 사이트에 원케어배관 말고도 다른 업체 페이지가 섞여 있음(유리창청소 010-8226-0126, 제트스키 010-3267-4506 등) → 홈에 쓸 "대표 업체"를 DB에서 추측할 수 없음
- 대기열 공개 10개 페이지 FAQ 30개 중 8개가 물음표 없는 평서문(예: "관리사무소에 설명할 자료가 필요해요"). 공개 페이지 수동 FAQ 전체로는 42개 중 14개. 화면 FAQ와 FAQPage JSON-LD는 일치함

### 결정(사용자, 2026-10-25)

- 홈·llms.txt 업체 정보: **관리자 설정에 '사이트 대표 업체' 칸 신설**(migration 017). 비어 있으면 업체 소개·연락처 없이 서비스·지역 링크만
- 기존 페이지 제목형 업체명·주소: **주소처럼 보일 때만 사용**(DB는 그대로, 구조화 데이터·자동 FAQ에서만 거름)

### 바뀐 것

| 항목 | 내용 |
| --- | --- |
| migration 017 `site_profile` | 단일 행(`id='default'`), 업체명 100·소개 320·전화 30·카카오 500자. anon 읽기만, authenticated 수정만(추가·삭제 정책 없음). 되돌리기 `supabase/rollback/017_down.sql` |
| 관리자 설정 | "사이트 대표 업체" 카드(업체명·한 줄 소개·대표 전화·카카오 URL). `updateSiteProfileAction` |
| 공개 홈 `/` | /admin 이동 대신 공개 홈: 대표 업체 소개·전화·카카오(설정한 값만), 서비스(키워드)별 링크(키워드당 최대 12개 + 시/군 모음 링크), 지역(시/군 모음)별 링크. JSON-LD WebSite + LocalBusiness(`/#business`, areaServed=허브 시/군). 템플릿 A 톤. 관리자 링크 없음 |
| robots | `disallow: /admin, /login, /api`(모두 끝 슬래시 없이 — 주소 자체와 하위 경로를 함께 막음. 예전 `/admin/`는 `/admin` 자체를 못 막았음. 앞부분 일치라 `api…`·`admin…`·`login…`으로 시작하는 slug도 막히므로 아래 slug 규칙으로 만들 수 없게 함. Disallow는 `lib/slug.ts`의 `BLOCKED_SLUG_PREFIXES`로 만든다), `allow: /, /area/, /llms.txt`, sitemap. 쓰이지 않던 루트 `robots.txt`(도메인 틀림) 삭제 |
| sitemap | 첫 항목에 홈. lastmod = 홈에 보이는 페이지·대표 업체 설정 중 최신(기존 페이지 수정은 홈 lastmod에 영향 없음, 보이는 것이 없으면 생략) |
| `/llms.txt` | 동적 생성(llmstxt.org 형식): 업체명(없으면 도메인)·한 줄 소개·서비스별 페이지·시/군 허브·문의 방법(설정 값만 + 상담 신청 양식)·홈/sitemap 주소 |
| 경로(Breadcrumb) | 홈이 공개되어 "홈 › 시/군 › 페이지"로 다시 넣음. 시/군 없으면 "홈 › 페이지". 지역 모음 페이지에도 "홈 › 시/군" 표시 + BreadcrumbList |
| 랜딩 구조화 데이터 | areaServed "군포시 군포시 산본동" 중복 수정. 주소 칸이 주소처럼 보일 때만 PostalAddress(`lib/business-info.ts`). 주소·서비스 지역이 없으면 Organization. 업체명이 대표 업체와 같으면 홈과 같은 `@id`·이름·url(홈)·소개, 전화는 페이지 값 → 대표 업체 값. WebPage에 `inLanguage`·`isPartOf`(WebSite) |
| 자동 SEO·FAQ | 업체명=제목이면 title "X \| X" 중복 제거. meta description에서 해시태그·줄바꿈 제거(화면 본문은 그대로). 자동 FAQ: 업체명이 이름으로 보일 때만 "OO은/는 어떤 곳인가요?"(조사 자동), 주소처럼 보일 때만 위치 FAQ |
| AEO | 대량 생성 프롬프트 규칙 7 "FAQ 질문은 손님 말투의 실제 질문 한 문장, 물음표로 끝냄"(글자 수 규칙은 8번으로). 대량 등록 검사에 경고 `faq_not_question`(저장은 막지 않음) |
| slug 규칙 | `admin`·`login`·`api`로 시작하는 slug(예: `admin-xxx`, `apink-xxx`) 금지 — 공용 `isReservedSlug`에 앞부분 검사 추가. 수동 생성·수정·복제·대량 등록(엑셀·붙여넣기·대기열 수정)·백업 복구가 같은 함수를 쓰고, 프롬프트 만들기는 "지역slug-키워드slug"가 걸리는 지역이 있으면 프롬프트를 만들지 않고 알려 줌. 문구 "admin, login, api로 시작하는 URL은 사용할 수 없습니다(검색엔진 차단 주소와 겹침)."(예약어와 똑같으면 기존 문구). 2026-10-25 운영 DB 확인(읽기만): 랜딩·대기열에 해당 slug 0개 |
| `<html lang>` | `en` → `ko` |

### 검증

- `npm test` 524개 ✅(기존 458 + `tests/seo-geo.test.tsx` 44, `tests/site-profile.db.test.ts` 9, slug 규칙 케이스는 validation·actions 테스트에도 추가). 기존 테스트 중 "홈 없음"·sitemap 개수·"X \| 업체명"·"admin-gym 허용"을 기대하던 것은 새 동작에 맞게 고침. 2단계 동작 비교 테스트의 예전 코드 사본은 고치지 않고, 비교 입력의 `admin-gym`만 `my-admin-gym`으로 바꿈
- 일부러 망가뜨려 확인(확인 후 원복): robots `/admin/` → 1개 실패, areaServed 중복 제거 빼기 → 2개, 홈 lastmod에 모든 페이지 → 2개, 017 anon 읽기 정책 제거 → 2개, 주소 판별 제거 → 1개, 대표 업체 묶기 제거 → 2개, slug 앞부분 검사 제거 → 15개
- `npx tsc --noEmit` ✅ / `npx eslint` ✅ / `npx next build` ✅(`/llms.txt` 동적, 빌드 로그 "Dynamic server usage"는 기존과 같은 안내)
- 실데이터 화면 확인은 못 함(로컬 `.env.local` 없음) → PR 미리보기 배포에서 확인

### 배포할 때(사용자 승인 후)

1. 운영 DB에 017 적용(백업 후, 이전처럼 `begin;`/`commit;` 한 트랜잭션) → 적용 전에 배포해도 홈·llms.txt는 업체 정보 없이 동작하고 관리자 저장만 실패
2. 배포 → 관리자 설정 "사이트 대표 업체"에 실제 값 입력(업체명을 랜딩페이지 업체명과 똑같이 쓰면 그 페이지들이 같은 업체로 묶임 — 지금은 대기열 10개 "원케어배관")
3. 확인: `/` 200·H1·JSON-LD, `/llms.txt`, `/robots.txt`, `/sitemap.xml` 첫 항목 홈, 랜딩·허브 경로 "홈 › …"
4. 서치어드바이저·Search Console에 홈 수집 요청(선택)

### 남은 것

- 백업 파일(version 3)에 `site_profile`은 아직 들어 있지 않음(4칸이라 복구 후 다시 입력하면 됨) — 필요하면 version 4로
- 기존 1,047개의 업체명 칸은 대부분 제목형 문구라 구조화 데이터 `name`도 그 문구 그대로 나감 — 관리자 화면에서 업체명을 실제 상호로 고치면 해결(코드로 추측해서 바꾸지 않음)
- 이미 공개된 FAQ 평서문 8개(대기열 10개 페이지)는 그대로 — 고치려면 관리자 화면 FAQ에서 질문 문장으로 수정

## 2026-10-25 운영 작업 기록

### 운영 DB 데이터 수정(사용자 승인 후, 각각 한 트랜잭션)

| 작업 | 대상 | 결과 | 백업·되돌리기 |
| --- | --- | --- | --- |
| 업체명 정리 | 전화 숫자 `01020688782`인 랜딩 1,033개 중 이미 '원케어배관'인 1개를 뺀 1,032개 | `business_name` → '원케어배관'(다른 업종 0개라 제외 없음). `updated_at`은 트리거가 갱신(사용자 선택). 다른 번호 그룹·다른 칸 해시 비교로 변경 없음 확인 | `C:\Users\user\Documents\onecare-backup\2026-10-25_business-name\` — `backup.json`, `update.sql`, `rollback.sql`(업체명 + 원래 updated_at 복원) |
| 대기열 10개 전화번호 | `published_at` 있는 10개(모두 phone 비어 있었음) | `phone` → '010-2068-8782'. 전화 버튼·Organization telephone·자동 FAQ "전화 상담은…" 생김 | `C:\Users\user\Documents\onecare-backup\2026-10-25_queue10-phone\` — 같은 구성 |

### PR #2 배포

| 순서 | 작업 | 결과 |
| --- | --- | --- |
| 1 | 운영 DB 백업(SELECT만) | `C:\Users\user\Documents\onecare-backup\2026-10-25_1938_pre-pr2\` — 11개 테이블 전부 DB 행 수 = 저장 행 수(landing_pages 1,057, events 592, faqs 42, seo 16, 상담 7, queue 10, indexnow 10·1, publish_runs 1, 설정 2) + `schema.json`(칸 116·제약 61·인덱스 26·트리거 12·함수 7·정책 29·확장 6·버킷 1·cron 1) |
| 2 | migration 017 | 사전 점검(없음) → 원본에 `begin;`/`commit;`만 붙여 실행 ✅. `site_profile` 1행(전부 빈 값)·RLS·정책 3개(authenticated 조회·수정, anon 조회). 사이트(main 코드) 정상 |
| 3 | 배포 전 운영 | **`dpl_26sZGXgMipT3h8BqtphNzbZ6vPRi`**(PR #1, 10-23) ← 되돌리기용 |
| 3 | 머지 | 사용자 "머지해" → PR #2 merge commit **`a8228cf`**(미리보기 빌드 성공·충돌 없음 확인 후) → 자동 배포 **`dpl_5SPe4Md9ChMBCp4gnmMab9v5PAkt`** READY(10-25 19:55 KST) |
| 4 | 배포 후 확인(GET) | 아래 표 — 모두 정상 |

| 확인 | 결과 |
| --- | --- |
| `/` | 200 공개 홈, `lang="ko"`, index/follow, H1 1개, 서비스 4개(누수탐지·배관청소·정화조막힘·하수구뚫음)·허브 3개 링크, `/admin`·`/login` 링크 없음. 대표 업체 미입력이라 WebSite JSON-LD만(이름 = 도메인) — 설계대로 |
| `/admin`, `/admin/settings` | 307 → `/login`, `/login` 200 |
| robots.txt | `Allow: / /area/ /llms.txt`, `Disallow: /admin /login /api`, Sitemap 줄 |
| `/llms.txt` | 200 `text/plain; charset=utf-8`, 서비스 4·허브 3, 문의는 "상담 신청 양식"만(대표 업체 미입력) |
| sitemap.xml | **1,061개 = 랜딩 1,057 + 허브 3 + 홈 1**, 중복 0. 첫 항목 홈, lastmod 2026-10-25T10:14:01Z(대기열 10개 전화번호 수정 시각) |
| 랜딩 3개 | 대기열 페이지(`gunpo-sanbon-leak-detection`): LocalBusiness·areaServed "군포시 산본동"(중복 해소)·전화, 경로 "홈 › 군포시 › …". 기존 페이지(`onecareplumb`): 엉터리 주소 빠지고 Organization. 다른 업종(`siheung-jeongwangdong-window-cleaning-0002`): 제목형 업체명의 "…은 어떤 곳인가요?" FAQ 빠짐. 3개 모두 화면 FAQ = FAQPage, BreadcrumbList = 화면 경로 |
| `/area/gunpo` | 200, H1 1개, 경로 "홈 › 군포시", ItemList 5개 + BreadcrumbList |

- 되돌리기: Vercel에서 `dpl_26sZGXgMipT3h8BqtphNzbZ6vPRi`로 promote(또는 `vercel rollback`). 017은 테이블만 추가라 이전 코드와 함께 동작(필요하면 `supabase/rollback/017_down.sql`)
- 대표 업체(`site_profile`)는 **사용자가 관리자 설정에서 직접 입력**하기로 함(SQL로 넣지 않음). 입력하면 홈에 업체 소개·연락처·LocalBusiness가 생기고, 업체명이 '원케어배관'이면 랜딩 1,043개가 홈과 같은 업체(`/#business`)로 묶인다

## 2026-10-26 운영 Storage 중복 사진 정리 ✅ (코드 변경 없음, 사용자 단계별 승인)

무료 플랜 Storage 1GB 한도를 넘어(버킷 `landing-page-assets` 2,071개·3,463.6MB) 같은 사진 사본을 정리했다. 압축·리사이즈는 하지 않음(사진 기능 작업 때 함께).

### 원인

- 같은 PNG 24장이 페이지마다 새 경로(`landing-pages/{id}/logo-…|main-…`)로 다시 올라가 1,000번 넘게 복사돼 있었음(09-09 ~ 10-22 업로드). 같은 사진이 어떤 페이지에선 로고, 어떤 페이지에선 메인으로 쓰이기도 함
- 앱은 이미지 교체·삭제 때 다른 행이 같은 주소를 쓰면 파일을 지우지 않으므로(`removeLandingPageImageByUrl`), 여러 페이지가 파일 하나를 함께 써도 안전함

### 순서와 결과

| 단계 | 내용 | 결과 |
| --- | --- | --- |
| 1 중복 확인(읽기만) | 크기 + eTag(단일 업로드 MD5)로 묶음 | 고유 24묶음(크기 같고 eTag 다른 경우·반대 경우 0). DB 전체(public·auth·cron 38개 테이블의 글자·JSON·배열 칸)에서 이 버킷 주소를 쓰는 칸은 `landing_pages.logo_url`(1,040)·`main_image_url`(1,039)·`landing_page_seo_settings.og_image_url`(1)뿐. 대기열·site_profile 0. 깨진 주소 0 |
| 2 백업 | DB 전체 + 고유 파일 24개 + 대응표 | 12개 테이블 행 수 일치(landing_pages 1,107 등), 파일 24개 크기·MD5 = eTag, SHA-256 24개 모두 다름 |
| 3 주소 바꾸기 | 묶음마다 가장 먼저 올린 파일을 남김(새로 올리지 않음). 한 트랜잭션에서 updated_at 트리거 2개를 잠시 끄고 바꾼 뒤 다시 켬 | 로고 1,022·메인 1,031·og 1행(랜딩 1,037개). 실행 후 서로 다른 주소 24개, 없는 파일 0, `updated_at` 최신값 그대로(`2026-10-26 00:00:00.187Z`), 트리거 켜짐 |
| 4 파일 삭제 | DB 어디에서도 안 쓰는 파일만 Storage API `remove`로 100개씩(묶음마다 참조 재확인). service_role 키는 CLI로 받아 메모리에서만 사용(저장·출력 안 함) | 2,047개 삭제(21묶음, 실패 0). **버킷 24개·44,335,299B(약 44.3MB)** |

- 확인(GET): `dangjin12`(og 바뀐 페이지), `zxcasd1`, `incheon-guwol-drain-service-copy`(307개 묶음), `qwe12345`, `turtleboy`(템플릿 B) — 3단계 후·4단계 후 모두 og:image·JSON-LD image/logo·화면 로고/대표 이미지 200, 남긴 파일을 가리킴

### 백업·되돌리기

`C:\Users\user\Documents\onecare-backup\2026-10-26_storage-dedup\`
- `db\`(테이블 JSON·`storage.objects` 메타데이터·schema·counts), `files\`(고유 24개, 파일 이름 = 경로의 `/`를 `__`로), `mapping.csv`(원래 경로 → 남긴 경로, 2,071줄), `delete-list.csv`·`delete-log.csv`(2,047개), `update.sql`·`rollback.sql`·`preview.sql`, `scripts\`
- 되돌리기: `files\`의 파일을 `mapping.csv`의 원래 경로로 다시 올린 뒤 `rollback.sql`(1,038행, updated_at 유지). 되돌리면 다시 3.4GB가 됨

### 다음 사진 작업 때 할 것

- 업로드 전 압축·리사이즈, 같은 파일은 해시로 한 번만 저장(사진 보관함) — 그렇지 않으면 같은 문제가 다시 생김
- 결정(사용자, 2026-10-26): 업체명은 대표 업체명과 **같을 때만** 홈 업체로 묶음(현행 유지). 오늘 공개 주소 체크박스에서 '전체 복사'는 체크하지 않음(체크 상태 저장 위치는 DB 추천, 아직 미결정)

## 관리자 화면 손질 — `feature/admin-tweaks` (2026-10-26, 운영 DB 접속 없음·migration 미적용·배포 안 함)

`main`(a8228cf)에서 새 브랜치. main에는 10-25 운영 기록 커밋(62c9bd1)이 없어서 HANDOFF.md는 그 기록과 위 Storage 정리 기록을 포함한 파일을 그대로 가져옴.

### 1. 오늘 공개된 주소 — 수집 요청 완료 체크(DB 저장)

- 공개 대기열 화면 '공개된 주소' 카드: 주소 상자(textarea) 대신 한 줄씩 `[체크] 주소 [URL 복사]`. 'URL 복사'에 성공하면 자동 체크, 직접 체크·해제 가능, "n / 전체 수집요청 완료" 표시. 위쪽 '전체 복사'는 그대로이고 눌러도 체크하지 않음(사용자 결정)
- 체크는 화면에 먼저 반영하고 저장. 저장 실패(권한·네트워크·페이지 삭제)면 체크를 되돌리고 안내 문구. 저장 중인 줄은 체크칸 잠금. 날짜를 바꾸면 카드를 새로 그림(`key`)
- migration **018** `search_submission_checks`(`landing_page_id` PK·FK `on delete cascade`, `checked_at`, `checked_by default auth.uid()`). RLS: authenticated 조회·추가·삭제만, anon 정책 없음. 되돌리기 `supabase/rollback/018_down.sql`
- 018 적용 전에 코드가 나가도: 주소 목록은 보이고 "수집 요청 완료 표시를 불러오지 못했습니다." 안내, 체크 저장만 실패
- 백업 파일(version 3)에는 이 테이블이 들어가지 않음(site_profile과 같음 — 필요하면 version 4)

### 2. 업체명 일괄 변경

- **랜딩페이지 관리**: 검색(업체명·제목·URL, `?search=`, 페이지 이동에도 유지), 줄마다 체크박스 + "이 페이지 전체 선택". 한 페이지(50개)를 다 고르면 "검색 결과(또는 전체 페이지) N개 모두 선택"(1,000개 넘어도 1,000행씩 끝까지 읽음)
- **공개 대기열**: 기존 선택 체크박스에 같은 기능. 공개된 항목은 고를 수 없고 바꾸지 않음(공개된 페이지는 랜딩페이지 관리에서). 다른 페이지 항목까지 고른 상태에서는 기존 '보류 → 공개 대기'·'삭제'를 막음(그 둘은 지금처럼 이 페이지 50개 기준)
- 바꾸기: "선택한 n개 업체명 바꾸기 [새 업체명] [업체명 바꾸기]" → 확인 창 `n개 페이지를 "A", "B" 외 k개 → "새 이름"으로 바꿉니다.`(로/으로 자동) → **100개씩** 순서대로 전송. 중간 실패면 멈추고 "n개 중 m개까지 처리" 안내
- 서버(`renameLandingPagesAction`·`renameQueueItemsAction`)가 다시 검사: id 1~100개·uuid, 업체명 필수·앞뒤 공백 제거 후 100자(`validateBusinessNameInput`, 글자 수 문구는 생성·수정과 같음)
- 이미 같은 이름인 행은 건드리지 않음(`neq`) → 그 페이지의 `updated_at`(sitemap lastmod)은 그대로. 바뀐 페이지는 트리거가 `updated_at` 갱신
- 홈 대표 업체 묶기 규칙은 그대로(이름이 똑같을 때만). 막대 아래에 지금 대표 업체명과 이 규칙을 안내
- 캐시 갱신: `/admin/pages`, `/admin`, 바뀐 페이지 `/{slug}`, `/area/[citySlug]`(page), 대기열은 `/admin/queue`

### 바뀐 파일

| 파일 | 내용 |
| --- | --- |
| `supabase/migrations/018_search_submission_checks.sql`, `supabase/rollback/018_down.sql` (신규) | 체크 테이블·RLS / 되돌리기 |
| `lib/search-submission-checks.ts` (신규) | 체크 조회(100개씩 `.in()`)·저장(중복 23505 = 성공, FK 23503 = "페이지를 찾을 수 없습니다") |
| `lib/local-pages.ts` | `getPublishedUrlsForDate` 결과에 `id` 추가 |
| `components/admin/PublishedUrlsPanel.tsx`, `app/admin/queue/page.tsx` | 줄 목록·체크·완료 수 / 체크 상태·대표 업체명 전달 |
| `lib/search-term.ts` (신규), `lib/publish-queue.ts` | 검색어 정리·`.or()` 필터 공용화(대기열 검색 동작 같음) / 대기열 일괄 변경 대상 조회·업체명 변경 |
| `lib/landing-pages.ts` | `getLandingPagesPage(page, search)`, `getLandingPageRenameTargets`, `renameLandingPages` |
| `lib/landing-page-validation.ts`, `lib/business-info.ts`, `lib/business-name-rename.ts` (신규) | `validateBusinessNameInput`·`BUSINESS_NAME_RENAME_CHUNK_SIZE` / `withDirectionParticle` / 나누기·확인 문구 |
| `app/admin/pages/actions.ts`, `app/admin/queue/actions.ts` | 일괄 변경·전체 선택·체크 저장 Server Action |
| `components/admin/{BusinessNameRenameBar,SelectAllResultsNotice,PageSearchForm}.tsx` (신규), `PageTable.tsx`, `QueueTable.tsx`, `app/admin/pages/page.tsx` | 화면 |
| `tests/admin-tweaks.db.test.tsx` (신규), `tests/bulk-components.test.tsx` | 테스트 24개 / 공개 주소 카드 테스트를 새 화면에 맞춤 |

### 검증

- `npm test` ✅ 23개 파일, **548개**(기존 524 + 신규 24). PGlite(migration 001~018): 018 권한(anon 차단)·기본값·cascade·두 번 적용·되돌리기, 체크 저장/재체크/해제·250개 조회·잘못된 입력·anon 저장 실패·테이블 없음, 대기열 화면에 DB 체크 상태·"1 / 2 수집요청 완료", 업체명 검사 경계(100/101자)·100개씩 나누기·확인 문구·조사, 선택한 행만·같은 이름은 updated_at 유지, 서버 재검사(빈 값·101자·id 0/101개·uuid 아님), 검색 3칸·1,201개 전체 선택, 1,200개를 100개씩 바꾸기, 대표 업체 묶기(“원케어배관 산본점”은 안 묶이고 “원케어배관”은 묶임), 대기열 공개 항목 제외·상태/검색 조건 전체 선택(1,100개), 화면 정적 렌더링(기존 칸·버튼 유지)
- `npx tsc --noEmit` ✅ / `npx eslint .` ✅ / `npx next build` ✅(빌드 로그 "Dynamic server usage"는 기존과 같음)
- 브라우저 클릭(복사·체크·확인 창)은 자동 테스트하지 않음 → 미리보기 배포에서 확인. 미리보기도 운영 DB를 쓰므로 018 적용 전이면 체크 저장은 실패(안내 문구)하고, **업체명 바꾸기는 운영 데이터가 실제로 바뀜** — 미리보기에서 시험할 때 주의

### 배포할 때(사용자 승인 후)

1. 운영 DB 백업 → 018 적용(`begin;`/`commit;` 한 트랜잭션, 테이블 추가만이라 지금 코드와도 함께 동작)
2. 머지 → 자동 배포 → `/admin/queue` 체크·URL 복사, `/admin/pages` 검색·선택·업체명 바꾸기(시험용 페이지 1개로) 확인

### 운영 배포 ✅ (2026-10-26, 사용자 단계별 승인)

| 순서 | 작업 | 결과 |
| --- | --- | --- |
| 1 | 운영 DB 백업(SELECT만) | `C:\Users\user\Documents\onecare-backup\2026-10-26_admin-tweaks-deploy\` — 12개 테이블 전부 받기 전 = 받은 뒤 = 저장 행 수, 기본키 중복 없음(landing_pages 1,107, events 608, faqs 192, queue 85, seo 66, indexnow 60·2, 상담 7, publish_runs 2, 설정 3개 각 1) + `schema.json`(칸 122·제약 67·인덱스 27·트리거 4·함수 7·정책 32·확장 6·버킷 1·cron 1) + storage.objects 목록 + 사진 24개(44,335,299 B, 크기 일치). 스크립트 `scripts\backup.mjs` |
| 2 | migration 018 | 사전 점검(테이블·정책 없음, `landing_pages.id` uuid PK, `auth.uid()`·역할 있음) → 원본에 `begin;`/`commit;`만 붙여 실행(`apply-018.sql`) ✅. 테이블·PK·FK(ON DELETE CASCADE)·RLS·정책 3개(authenticated 조회·추가·삭제), 0행. anon 역할로 조회 0행·추가는 RLS 위반으로 막힘(롤백 트랜잭션에서 확인). 기존 12개 테이블 행 수 그대로, 사이트(이전 코드) 정상 |
| 3 | 배포 전 운영 | `a8228cf` = **`dpl_5SPe4Md9ChMBCp4gnmMab9v5PAkt`** (`onecarelandingprogram-ouzonk4id-habin-s-projects.vercel.app`) ← 되돌리기용 |
| 3 | 머지 | 사용자 "머지해" → main이 `a8228cf` 그대로인지 확인·`npm test` 548개 통과 → 로컬 `--no-ff` merge commit **`9a46d67`** push(PR 없음) → 자동 배포 **`dpl_48gHwvsYw2csMeUXP8qAtDGRWaad`** 성공(`onecarelandingprogram-eu6o0r60f-habin-s-projects.vercel.app`, 10-26 15:12 KST) |
| 4 | 배포 후 확인(GET·읽기만) | 아래 표 — 모두 정상 |

| 확인 | 결과 |
| --- | --- |
| `/`, `/area/gunpo` | 200, H1 1개, `lang="ko"`, 오류 화면 없음 |
| 랜딩 `/dangjin12`·`/zxcasd1`·`/turtleboy`·`/incheon-guwol-drain-service-copy` | 200, 로고·대표 사진(`/_next/image`) 200 image/png |
| sitemap.xml·robots.txt·llms.txt | 200, sitemap 1,111개·중복 0 |
| `/login` / `/admin`·`/admin/queue`·`/admin/pages`(`?search=` 포함) | 200 / 307 → `/login` |
| 관리자 화면 쿼리(authenticated 역할, 롤백 트랜잭션) | 체크 테이블 조회 0행 정상, 오늘(KST) 공개 50개, 3칸 ilike 검색 동작 |

- 로그인한 관리자 화면은 계정이 없어 Claude가 열어보지 않음 → 사용자 확인 필요. 체크·업체명 변경은 운영 데이터를 바꾸므로 Claude가 누르지 않음
- 되돌리기: Vercel에서 `dpl_5SPe4Md9ChMBCp4gnmMab9v5PAkt`로 promote. 018은 테이블만 추가라 이전 코드와 함께 동작(필요하면 `supabase/rollback/018_down.sql`, 체크 기록이 지워짐)
- 업체명을 잘못 바꿨을 때: 이번 백업의 `db\data\landing_pages.json`·`landing_page_queue.json`에 배포 직전 업체명·updated_at이 있음

## 사진 기능 — `feature/photos` (2026-10-26, 운영 DB 읽기만·migration 019 미적용·배포 안 함)

조사 때 계획대로 만들었다. 압축은 브라우저에서(새 라이브러리 없음), 같은 사진은 한 번만 저장.

### 1. 사진 보관함(관리자 메뉴 "사진 보관함", `/admin/media`)

- 여러 장 한꺼번에 올리기(사진/로고 선택) → 한 장씩 브라우저에서 줄여서 올림: 사진 긴 변 1600px WebP 0.8, 로고 512px WebP(투명 유지). WebP를 못 만드는 브라우저는 사진 JPEG·로고 PNG. 2MB 안에 들 때까지 품질을 0.7→0.6→0.5로 낮춤. 다시 그려서 위치(GPS) 정보도 빠짐
- 같은 사진: **원본 파일의 sha256**으로 `library/{sha256}.webp` 한 곳에만 저장. 올리기 전에 같은 sha256이 있으면 업로드 없이 기존 사진을 씀("이미 있는 사진")
- og:image용 1200×630 JPEG(가운데 채워 자름, 로고는 흰 바탕 가운데)를 `library/{sha256}-og.jpg`로 함께 저장 → 사진1이 보관함 사진이면 주소만 보고 OG 주소를 앎(칸 추가 없음)
- HEIC/HEIF: 형식·확장자로 알아보고 "아이폰 설정 > 카메라 > 포맷 > 높은 호환성" 안내 후 거절
- 등록: 브라우저가 Storage에 두 파일을 올린 뒤 서버가 Storage 목록으로 **두 파일이 있는지·2MB 이하인지 다시 확인**하고, 주소·경로는 서버가 sha256으로 만듦. 이름은 올린 파일 이름, 겹치면(대소문자 무시) "이름 (2).jpg"
- 목록: 검색(이름)·종류(전체/사진/로고)·60장씩, 크기·해상도·"사용 중 n곳", 이름 복사, 삭제
- 삭제: 쓰는 곳이 있으면(본 파일 또는 OG 파일 주소) 거절하고 어디서 쓰는지 알려 줌. 확인이 실패해도 지우지 않음. 목록 행을 먼저 지우고 파일 2개를 지움
- 페이지에서 사진을 바꾸거나 페이지를 지워도 보관함 파일은 지우지 않음(예전 `landing-pages/` 파일만 쓰는 곳이 없을 때 정리)

### 2. 페이지마다 사진 3장 + 로고

- 사진1 = 기존 `main_image_url`/`main_image_alt` 그대로, 사진2·3 칸(`image_2_url`·`image_2_alt`·`image_3_url`·`image_3_alt`) 추가 — 페이지·대기열 모두
- 페이지 만들기·수정 화면: "사진·로고" 칸(로고 + 사진1~3과 설명). 칸마다 "보관함에서 고르기 / 새로 올리기"(창 안에서 바로 올리면 그 사진이 골라짐)·비우기. 수정 화면은 "사진 저장" 버튼(또는 "수정하기"를 누르면 바뀐 사진도 함께 저장). **예전처럼 고르는 즉시 저장되지는 않음**
- 대기열 수정 화면: 사진 칸 3개에 "보관함에서 고르기" 버튼(주소가 들어감), 사진2·3과 설명 칸 추가
- 랜딩 화면: 사진1은 기존처럼 첫 화면, 사진2·3은 현장 사례 아래 "현장 사진" 갤러리(`<img alt>` + 설명). 설명이 비면 사진1 "지역 키워드 현장", 사진2·3은 뒤에 번호
- 로고: 대표 업체(설정 > 사이트 대표 업체 > 대표 업체 로고, 고르면 바로 저장) 1개 + 페이지별. 페이지 로고가 비어 있으면 **업체명이 대표 업체와 같은 페이지만** 대표 로고(헤더·구조화 데이터 logo·og 대체)
- og:image: 전용 OG(SEO 설정) → 사진1의 1200×630 JPEG(width/height 함께) → 사진1(보관함 밖 주소) → 로고(대표 로고 포함). SEO 설정의 전용 OG 올리기도 1200×630 JPEG로 줄임
- 구조화 데이터: LocalBusiness/Organization `image` = 사진1~3 배열, `logo` = 위 로고 규칙. 홈 LocalBusiness에도 대표 로고

### 3. 엑셀 대량 등록

- 양식 맨 뒤에 "사진2, 사진2 설명, 사진3, 사진3 설명"(29칸). 머리글로 찾으므로 이전 25칸·20칸 양식, 머리글 없는 붙여넣기 순서도 그대로
- 사진 칸(대표 사진 URL·사진2·사진3)에는 보관함 이름 또는 http(s) 주소. 이름은 대소문자 무시, 확장자 생략 가능(맞는 사진이 하나일 때). 저장할 때 주소로 바꿈
- 없는 이름 → 오류 "사진2: 사진 보관함에 "x" 사진이 없습니다…"(그 행은 대기열에 안 들어감), 여러 장과 맞으면 오류, "/"가 든 값·http(s)가 아닌 주소는 예전 문구 그대로 형식 오류
- 얇은 페이지 경고·공개 함수의 얇은 페이지 판단: 사진1~3 중 하나라도 있으면 사진 있음
- `docs/samples` 양식·프롬프트 예시 다시 만듦(`npm run samples`. 프롬프트 예시에는 이전 브랜치에서 바뀐 FAQ 규칙 7번도 함께 반영됨)

### 4. 삭제 안전장치

- 참조 확인 목록 한 곳(`lib/storage/asset-references.ts` `IMAGE_REFERENCE_COLUMNS`): 페이지 로고·사진1~3, SEO OG, **공개 전** 대기열 사진1~3, 대표 업체 로고. 보관함 삭제와 예전 파일 정리(`removeLandingPageImageByUrl`)가 같은 목록을 씀
- 테스트로 고정: DB의 `*image*url`·`*logo*url` 칸 전체와 목록이 같아야 통과(새 칸을 빠뜨리면 실패), 칸마다 삭제가 막히는지 하나씩 확인. 칸 하나를 일부러 빼면 3개 실패하는 것 확인 후 원복

### 5. 백업 version 4

- 랜딩페이지·대기열 사진2·3 칸, 대표 업체 정보(`siteProfile`, 로고 포함), 보관함 목록(`mediaAssets`, 파일 자체는 안 넣음), 파일 목록에 image2·image3
- 복구: 사진 칸은 version 4 파일일 때만 씀(1~3 파일은 지금 값 유지), 대표 업체 정보 갱신, 보관함 목록은 id·sha256·이름이 겹치지 않는 것만 추가. 복구 화면에 두 줄 추가

### migration 019 (`supabase/migrations/019_photo_library.sql`, 되돌리기 `supabase/rollback/019_down.sql`)

- `media_assets` 테이블(sha256 unique, 이름 lower unique, 경로 형식·2MB check), RLS: authenticated 조회·추가·삭제, anon 없음
- 칸 추가: landing_pages·landing_page_queue 사진2·3(주소 500자·설명 200자), site_profile.logo_url(500자)
- Storage: 버킷 상한 10MB → **2MB**(이미 있는 파일엔 영향 없음), 업로드·교체 정책을 `library/`·`landing-pages/` 경로로 제한
- `publish_queued_landing_pages`: 사진2·3 복사 + 얇은 페이지 판단(그 밖은 016과 같음)
- 019_down: 016 공개 함수·005 정책·10MB로 되돌리고 칸·테이블 삭제(library/ 파일은 남음)

### 바뀐 파일

| 구분 | 파일 |
| --- | --- |
| migration | `supabase/migrations/019_photo_library.sql`, `supabase/rollback/019_down.sql` (신규) |
| 보관함 | `lib/media/library.ts`·`compress.ts`·`upload-client.ts`, `lib/media-assets.ts`, `lib/storage/asset-references.ts`, `app/admin/media/page.tsx`·`actions.ts`, `components/admin/MediaLibraryPanel.tsx`·`MediaUploadInput.tsx`·`MediaPickerDialog.tsx`·`PhotoSlotField.tsx` (신규), `lib/storage/landing-page-assets.ts`(참조 확인 교체), `AdminSidebar.tsx` |
| 페이지 사진·로고 | `lib/landing-photos.ts`, `components/admin/LandingPagePhotosCard.tsx` (신규), `LandingPageForm.tsx`, `ImageUploadField.tsx`(삭제), `app/admin/pages/actions.ts`·`[id]/edit`·`[id]/preview`, `lib/landing-pages.ts`, `lib/landing-page-validation.ts`, `lib/site-profile.ts`, `app/admin/settings/actions.ts`, `SiteProfileSettingsPanel.tsx`, `SeoSettingsPanel.tsx` |
| 공개 화면·SEO | `app/[slug]/page.tsx`, `LandingPageRenderer.tsx`, `LocalSeoSections.tsx`(갤러리), `TemplateA/B.tsx`, `lib/seo-resolver.ts`, `lib/seo.ts`, `lib/structured-data.ts` |
| 엑셀·대기열 | `lib/bulk-upload/columns.ts`·`check.ts`·`context.ts`·`enqueue.ts`, `app/admin/bulk/actions.ts`, `BulkUploadPanel.tsx`, `lib/publish-queue.ts`, `QueueItemForm.tsx`, `docs/samples/*` |
| 백업 | `types/backup.ts`, `lib/backup/export.ts`·`sanitize.ts`·`restore.ts`, `app/admin/settings/backup/validate/route.ts`, `BackupRestorePanel.tsx` |
| 타입 | `types/landing-page.ts`, `types/publish-queue.ts` |
| 테스트 | `tests/photos.db.test.tsx` (신규 61개), 기존 테스트 데이터에 새 칸 추가(`admin-tweaks`·`backup-publish-queue`·`bulk-components`·`bulk-upload-check`·`bulk-upload-queue`·`local-seo`·`local-seo-upload`·`seo-geo`), `tests/helpers/pglite-supabase.ts`(not·single) |

### 검증

- `npm test` ✅ 24개 파일, **609개**(기존 548 + 신규 61). 기존 테스트는 새 칸(사진2·3, 대표 로고, 보관함 목록)을 데이터에 넣고, 양식 칸 수·백업 version 숫자를 고정한 곳만 맞춤(version 3 읽기 검사는 그대로 version 3으로 확인)
- `npx tsc --noEmit` ✅ / `npx eslint .` ✅ / `npx next build` ✅(`/admin/media` 생김)
- 브라우저 압축(canvas)·실제 Storage 업로드는 자동 테스트하지 않음(크기 계산·형식 판별·서버 확인만) → 미리보기에서 확인 필요

### 배포할 때(사용자 승인 후)

1. 운영 DB 백업 → **019 먼저 적용**(`begin;`/`commit;`). 이 브랜치 코드는 019 없이는 대기열 저장·보관함이 안 됨
2. 019만 적용된 동안(머지 전) 예전 코드의 이미지 올리기는 2MB 넘는 파일이 거절됨(압축 없음) → 019 적용 후 바로 머지
3. 머지 → 자동 배포 → 보관함 올리기·고르기·삭제 막힘, 페이지 사진 저장, 랜딩 갤러리·og:image 확인
- 기존 페이지 사진(예전 `landing-pages/` 24개 파일)은 보관함 목록에 없다 — 그대로 보이고 og:image도 예전처럼 사진1 원본. 보관함으로 옮기려면 따로 작업(백업·승인 후)

### 이어서 한 작업 (2026-10-27, 운영 DB 접속 없음·019 미적용·배포 안 함)

계획 대비 빠져 있던 것을 채웠다. 먼저 최신 main(`38ec710`, list-copy-check 배포 완료)을 합침(충돌 2곳: HANDOFF·PGlite 어댑터 — 양쪽 모두 살림).

- **사진 설명**: `media_assets.description`(200자, 기본 빈 값) + authenticated 수정 정책(019에 추가). 올리기 화면에 "설명" 칸(이번에 올리는 사진 모두에 붙음), 보관함 목록에서 사진마다 고치기(바꾸면 '저장'), 검색은 이름·설명. 같은 사진을 다시 올리면 기존 설명이 비어 있을 때만 채움
- **설명 → alt**: 페이지·대기열 수정에서 보관함 사진을 고르면 비어 있던 설명(alt)에 보관함 설명. 엑셀 사진 칸이 보관함 사진이고 설명 칸이 비면 보관함 설명을 저장(주소로 쓴 사진은 그대로 비움)
- **대기열 로고**: `landing_page_queue.logo_url`(500자) + 공개 함수가 페이지 `logo_url`로 복사(019 수정, 019_down이 지움). 엑셀 선택 칸 `로고`(양식에는 없음, 머리글을 넣으면 인식 — 보관함 이름 또는 주소, 없는 이름은 오류). 대기열 수정 화면에 로고 칸(로고 보관함에서 고르기). 삭제 안전장치 목록에 "대기열 로고"(공개 전만), 백업 version 4에 대기열 로고·보관함 설명(아직 배포 전이라 version 번호는 그대로 4)
- **AI 프롬프트**: 프롬프트 만들기 화면이 보관함 사진(로고 제외, 이름 순, 1,000장 넘어도 전부)의 "파일 이름: 설명" 목록을 넣는다. 사진이 있으면 대표 사진 URL·사진2·사진3은 AI가 파일 이름으로 채우는 칸이 되고 규칙 9 추가: 내용에 맞는 사진, 목록 그대로의 이름만, 한 행에 같은 사진 두 번 금지, 여러 행에 몰리지 않게(한 사진 최대 = ⌈행×3 ÷ 사진 수⌉번, 나눈 프롬프트마다). 사진 설명 칸은 비워 두게 함(보관함 설명이 들어감). 보관함이 비면 예전 프롬프트와 글자 하나 다르지 않음. `docs/samples/prompt-with-photos.txt` 추가
- **공통 사진 설정**(올리기 화면 맨 위): 로고·대표 사진(사진1)·현장 사진(사진2·3)을 보관함에서 고름. 검사 전에 **빈 칸에만** 보관함 이름으로 넣음(행에 값이 있으면 행 우선, 같은 행 다른 사진 칸에 이미 같은 사진이면 넣지 않음) → 이후 검사·서버 재검사가 엑셀에 이름을 쓴 것과 똑같이 처리(설명 alt·지운 사진은 오류). 마지막 선택은 이 브라우저(localStorage)에 기억. 파일을 읽은 뒤 바꾸면 다시 검사
  - "현장 사진1~3"은 페이지 사진 칸이 3개(사진1=대표)라 **대표 사진(사진1) + 현장 사진(사진2·3)**으로 해석함

| 구분 | 파일 |
| --- | --- |
| migration | `019_photo_library.sql`(설명 칸·수정 정책·대기열 로고·공개 함수 로고 복사), `019_down.sql` |
| 보관함 | `lib/media/library.ts`(설명 정리·altAfterPick), `lib/media-assets.ts`(설명 저장·수정·프롬프트용 목록), `app/admin/media/actions.ts`, `lib/media/upload-client.ts`, `MediaUploadInput.tsx`, `MediaLibraryPanel.tsx`, `MediaDescriptionField.tsx`(신규), `PhotoSlotField.tsx`, `LandingPagePhotosCard.tsx` |
| 엑셀·대기열 | `lib/bulk-upload/columns.ts`(로고 선택 칸), `check.ts`(로고·설명 alt), `common-photos.ts`(신규), `prompt.ts`, `app/admin/bulk/page.tsx`·`actions.ts`, `BulkUploadPanel.tsx`, `CommonPhotoSettingsCard.tsx`(신규), `PromptBuilderPanel.tsx`, `QueueItemForm.tsx`, `lib/publish-queue.ts`, `types/publish-queue.ts` |
| 안전장치·백업 | `lib/storage/asset-references.ts`, `types/backup.ts`, `lib/backup/sanitize.ts`·`restore.ts` |
| 예시 | `scripts/generate-samples.ts`, `docs/samples/README.md`, `docs/samples/prompt-with-photos.txt`(신규) |
| 테스트 | `tests/photos.db.test.tsx`(+26개), 기존 테스트 데이터에 새 칸(`backup-publish-queue`·`bulk-upload-check`·`bulk-components`) |

검증: `npm test` **654개 통과**(합친 뒤 627 → 654), `tsc`·`eslint`·`next build` ✅. 일부러 망가뜨려 확인: 보관함 설명 alt 대체를 빼면 3개, 공통 사진의 같은 사진 건너뛰기를 빼면 1개 실패(원복). 브라우저 압축·localStorage·실제 클릭은 자동 테스트 없음(순수 함수·정적 화면으로 확인) → 미리보기에서 확인 필요.

배포할 때 순서는 위와 같다(백업 → **019 먼저 적용** → 머지). 019 내용이 늘었으니 적용 전에 파일을 다시 볼 것.

### 운영 배포 ✅ (2026-10-27, 사용자 단계별 승인)

| 순서 | 작업 | 결과 |
| --- | --- | --- |
| 1 | 운영 DB 백업(SELECT만) | `C:\Users\user\Documents\onecare-backup\2026-10-27_photos-deploy\` — 13개 테이블 전부 받기 전 = 받은 뒤 = 저장 행 수 = 고유 기본키(landing_pages 1,157, events 628, faqs 342, queue 135, seo 116, indexnow 110·3, 상담 7, publish_runs 3, 수집 체크 1, 설정 3개 각 1) + `schema.json`(칸 125·제약 69·인덱스 28·트리거 4·함수 7·정책 35·확장 6·버킷 1·cron 1) + Storage 24개 파일(44,335,299 B, 크기 일치). 스크립트 `scripts\backup.mjs`(지난번과 같음) |
| 2 | 019 사전 점검(`scripts\precheck-019.mjs`) | 019 미적용 확인, 역할·`auth.uid()`·`gen_random_uuid()` 있음(PG 17.6), **운영 공개 함수 = 016 본문과 글자 단위로 같음**(덮어써도 잃는 것 없음), 실행 권한 authenticated만, Storage 정책 005 그대로, 파일 24개 모두 `landing-pages/`(2MB 넘는 기존 파일 10개 — 상한은 새로 올리는 파일만), cron 09:00 KST(그날 실행 끝난 뒤 적용) |
| 2 | migration 019 | `apply-019.sql`(`begin;` + 커밋 `29ac003`의 019 + `commit;`) 실행 ✅ exit 0. 확인(`scripts\verify-019.mjs`): media_assets(RLS·정책 4·설명 칸)·페이지/대기열 새 칸·대기열 로고·대표 로고·버킷 2MB·업로드 경로 제한·공개 함수 로고 복사·권한 그대로. anon은 media_assets 0행·추가는 RLS 위반(42501)으로 막힘(롤백 트랜잭션, 남은 행 0). 기존 13개 테이블 행 수 백업과 같음. 사이트(이전 코드) 정상 |
| 3 | 배포 전 운영 | `38ec710` = GitHub deployment 7348683148 (`onecarelandingprogram-7bhgpgl2u-habin-s-projects.vercel.app`, list-copy-check 배포) ← 되돌리기용. dpl_ ID는 Vercel 로그인이 없어 못 읽음 |
| 3 | 머지 | 사용자 승인 → main이 `38ec710` 그대로인지 확인 → 로컬 `--no-ff` merge commit **`a9d20a4`**, 병합 결과 `npm test` 654개 통과 → push(PR 없음) → 자동 배포 GitHub deployment 7349262755 **success**(`onecarelandingprogram-2qkloz6zc-habin-s-projects.vercel.app`, 10-27 12:06 KST) |
| 4 | 배포 후 확인(GET·읽기만) | 아래 표 — 모두 정상 |

| 확인 | 결과 |
| --- | --- |
| `/`, `/dangjin12`, `/zxcasd1` | 200, H1 1개, JSON-LD 8개, 오류 화면 없음(배포 전과 같음) |
| 랜딩 `/osan-segyo-drain-unblocking-20261018-0040`(사진1+로고) | 200, H1 1, `<img>` 2개 모두 alt·200, og:image = 사진1(예전 `landing-pages/` 파일, 200 image/png), JSON-LD 4블록 유효(WebPage·LocalBusiness·FAQPage·BreadcrumbList), LocalBusiness `image` 배열(1), `logo` 있음 |
| 랜딩 `/qwertt12`(사진1만) | 200, `<img>` 1개 alt·200, og:image 사진1, `image` 배열(1), logo 없음(업체명은 대표 업체와 같지만 대표 로고가 아직 비어 있음) |
| 랜딩 `/siheung-maehwa-dong-septic-unblocking`(사진 없음) | 200, `<img>` 0, og:image 없음, `image` 없음, JSON-LD 유효 |
| 사진 갤러리 | 세 페이지 모두 사진2·3이 없어 갤러리 없음(정상) |
| sitemap.xml·robots.txt·llms.txt | 200, sitemap 1,161개·중복 0 |
| `/login` / `/admin`·`/admin/pages`·`/admin/media`·`/admin/bulk`·`/admin/queue` | 200 / 307 → `/login` |

- 기존 페이지 사진(예전 `landing-pages/` 24개 파일)은 그대로 보이고, og:image도 예전처럼 사진1 원본(1200×630 JPEG는 보관함 사진부터)
- 로그인한 관리자 화면(보관함 올리기·압축·설명·고르기·공통 사진·프롬프트)은 계정이 없어 Claude가 열어보지 않음 → 사용자 확인(아래 순서)
- 되돌리기: Vercel에서 GitHub deployment 7348683148(`onecarelandingprogram-7bhgpgl2u-…`)로 promote. 019는 추가만이라 이전 코드와 함께 동작(이전 코드의 이미지 올리기는 압축 없이 2MB 상한에 걸림). DB까지 되돌릴 때만 `supabase/rollback/019_down.sql`(보관함 목록·사진2·3·로고 칸 값이 지워짐 — 이번 백업으로 복구 가능)
- 이 기록 커밋은 `feature/photos`에만 둠(main에 올리면 문서만으로 운영 재배포가 생김)

### 사용자 화면 확인 순서(배포 후)

1. 사진 보관함(`/admin/media`): 사진 2~3장(JPG, 2MB 넘는 것 1장 포함) 한꺼번에 + 설명 → 줄마다 "올림", 크기 2MB 이하·1600px, 설명 보임. 같은 사진 다시 → "이미 있는 사진". HEIC → 안내 문구. 로고(PNG 투명) → 512px·투명 유지
2. 설명 고치기·검색(설명 낱말로)
3. 페이지 수정: 사진1~3·로고 "보관함에서 고르기" → 설명 칸 자동 → "사진 저장" → 공개 페이지 갤러리·공유 미리보기(og 1200×630)
4. 쓰는 사진 삭제 → 막힘 문구, 안 쓰는 사진 삭제 → 됨
5. 설정 > 대표 업체 로고 → 업체명이 같은 페이지 헤더에 로고
6. AI 대량 생성 > 프롬프트 만들기 → "사진 N장이 들어갑니다", 프롬프트에 목록·규칙 9
7. 올리기: 공통 사진 4칸 고르기 → 사진 칸 빈 엑셀/붙여넣기 검사 → "공통 사진을 n행에 넣어" 안내·오류 없음 → 새로고침해도 선택 기억 → 대기열 넣기 → 대기열 항목에 사진·로고 주소

## 랜딩페이지 목록 URL 복사완료 체크 — `feature/list-copy-check` (2026-10-27, migration 없음·운영 DB 접속 없음·배포 안 함)

- 목록 줄마다 [URL 복사] 오른쪽에 [☐ 복사완료](공개 페이지만, 왼쪽 업체명 선택 체크칸과 별개). 복사하면 자동 체크 + "복사됨", 직접 체크·해제 가능, 저장 실패 시 되돌리고 안내
- 저장은 운영에 이미 있는 `search_submission_checks`(018) 그대로 → 공개 대기열 '공개된 주소' 카드와 같은 체크. 체크 action은 `/admin/queue`·`/admin/pages` 둘 다 갱신
- 목록 위 필터 전체 / 복사완료 / 안 한 것(`?copy=done|todo`) + "n / 전체 복사완료"(검색 조건에 맞는 공개 페이지 기준). 검색·페이지 나눔과 함께 유지
- 필터는 서버에서 PostgREST 관계 조인으로: 복사완료 `search_submission_checks!inner(landing_page_id)`, 안 한 것 `search_submission_checks(landing_page_id)` + `.is("search_submission_checks", null)`(anti join, PostgREST 11.1+). '전체'는 기존 조회 그대로 + 화면의 50개만 체크 조회
- 체크 상태를 못 읽으면 숫자 대신 안내, 체크칸 숨김(목록·URL 복사는 그대로)
- 테스트: `tests/list-copy-check.db.test.tsx`(PGlite). PGlite 어댑터에 관계 조인(`table(cols)`·`!inner`·`is(table, null)`) 지원 추가
- ⚠ 관계 조인 문법은 실제 PostgREST(운영)에서는 아직 확인 안 함 — 이 PC에 `.env.local`이 없어 읽기 확인도 못 함. 배포 뒤 `/admin/pages?copy=done`·`?copy=todo` 화면을 한 번 열어 확인할 것

## 2026-10-30 네이버 노출 감소 점검 후 운영 작업 (사용자 승인)

배경: 10/24부터 네이버 노출 감소. 점검 결과 원인 후보 1순위는 대량·유사 페이지(완전 동일 본문 쌍, 의미 없는 주소 663개, 같은 동네·서비스 중복). 제목은 지금 그대로 두기로 함(사용자 결정).

| 작업 | 결과 | 백업·되돌리기 |
| --- | --- | --- |
| 매일 자동 공개 끄기 | `auto_publish_settings.enabled` true → false(1행, 다른 칸 그대로). pg_cron 작업은 그대로 — 꺼져 있으면 `{"status":"disabled"}`만 돌려줌(함수 본문 확인). 대기열은 183개 모두 공개된 상태였음 | `C:\Users\user\Documents\onecare-backup\2026-10-30_auto-publish-off\`(`before.json`·`update.sql`·`rollback.sql`) |
| C 분류 361개 noindex | 의미 없는 주소(`zxcvv12` 등) 중 사이트 방문·클릭 기록 0(전체 기간·최근 7일 모두 0, 처리 직전 재확인)이고 A·B·D(301 대상)에 안 걸린 것. 정왕동 유리창 0002/0004 제외. SEO 설정 행 360개 새로 만듦(`seo_noindex`=true, 나머지 기본값) + 기존 1행(`siheungsingcdae`) noindex만 true. landing_pages는 건드리지 않음(최신 updated_at 그대로) | `C:\Users\user\Documents\onecare-backup\2026-10-30_noindex-c361\`(`before.json`·`targets.csv`·`update.sql`·`rollback.sql`·`sitemap-before/after.xml`) |
| 확인 | 샘플 5개(`onecareplumb12`·`zaqw12`·`wiugal1`·`rsetzeryzey5`·`siheungsingcdae`) 200 + `<meta name="robots" content="noindex, follow">`(X-Robots-Tag 헤더 없음). sitemap 1,234 → **873**(361개 빠짐, 대상 0개 남음), 남은 주소 lastmod 변경 0 | |
| IndexNow | sitemap 주소 1개(`https://onecarepage.co.kr/sitemap.xml`)만 네이버 엔드포인트로 POST → HTTP 200. 앱의 IndexNow 기록 테이블에는 남기지 않음(DB 변경 범위 밖) | `…\2026-10-30_noindex-c361\indexnow-status.txt` |

- "방문·클릭"은 사이트 자체 기록(`landing_page_events`)이지 네이버 노출 수치가 아님
- noindex 361개 중 26개는 정리 목록에서 301의 **대표(남길 페이지)**로 잡혀 있던 것(A 5묶음, D 21묶음 — 의미 없는 주소끼리 묶인 곳). 301 작업 전에 대표를 다시 고르거나 묶음 전체를 noindex로 둘 것
- 정리 목록(A 본문 동일 25, B -copy, D 같은 동네·서비스 186)은 아직 처리 안 함 → 아래 301 기능 배포 후

## 301 이동 기능 + 설명의 "#" 제거 — `feature/redirects` (2026-10-30, migration 020 미적용·배포 안 함)

`main`(a9d20a4)에서 새 브랜치. HANDOFF.md는 `feature/photos`의 최신본을 가져옴.

### 1. 301 이동(옛 주소 → 새 주소)

- migration **020** `landing_page_redirects`(`from_slug` PK, `to_slug`, `note` 200자, `created_at`). slug 형식·자기 자신 금지 check. 트리거: 새 주소가 이미 이동된 옛 주소면 거절, 옛 주소가 다른 항목의 새 주소면 거절(→ 연쇄·순환 불가), 새 주소에 공개 페이지가 없으면 거절, 동시에 넣어 피하지 못하게 테이블 잠금. landing_pages에 외래 키 없음(옛 페이지를 지워도 이동 유지). RLS: anon·authenticated **읽기만**(쓰기는 SQL — 운영 작업 승인 후). 되돌리기 `supabase/rollback/020_down.sql`
- `proxy.ts`: `/한단어` slug 경로의 GET·HEAD만 목록을 보고 **301**(쿼리 유지). 예약 주소(admin·login·api·area 등)·하위 경로·파일은 건너뜀. 목록은 인스턴스에서 60초 기억(실패하면 10초 뒤 재시도). 목록을 못 읽으면(020 전·오류) 이동 없이 예전처럼 페이지 표시. `permanentRedirect`(308)가 아니라 `NextResponse.redirect(url, 301)` — 네이버 안내가 301 기준
- 옛 주소는 sitemap·홈·llms.txt(`getPublicLandingPagesForSitemap`)·지역 모음·내부 링크(`lib/local-pages.ts`, noindex와 같은 취급)에서 빠짐. 이동 목록을 못 읽으면 예전처럼 다 나옴
- 관리자 **"주소 이동"**(`/admin/redirects`): 목록 확인만(옛 주소·옛 페이지 상태·새 주소·새 페이지 상태·메모·등록일), "확인 필요" 표시(새 페이지가 비공개·없음·noindex·연쇄)
- IndexNow 대기 함수(015)는 바꾸지 않음 — 옛 페이지는 이미 공개·전송된 페이지라 대상이 아님

### 2. meta description·구조화 데이터의 "#"

- `stripHashMarks`(`lib/business-info.ts`): 남은 `#`(`### 제목`, 낱개 `#`)와 앞뒤 공백을 빈칸 하나로. `toPlainSummary`(자동 설명)에 적용, 직접 입력한 SEO 설명·OG 설명(`seo-resolver`), 대표 업체 소개의 구조화 데이터(`structured-data`)에도 적용. 화면 본문은 그대로
- 대상: 설명 맨 앞 `#` 24곳·중간 8곳(10-30 점검 목록)

### 검증

- `npm test` ✅ 26개 파일, **677개**(기존 654 + `tests/redirects.db.test.tsx` 23). PGlite 어댑터에 `별칭:table(cols)` 관계 조인 지원 추가(sitemap·허브 조회가 씀)
- 일부러 망가뜨려 확인(확인 후 원복): sitemap 필터 제거 → 1개, 허브·내부 링크 필터 제거 → 2개, 반대 방향 연쇄 검사 제거 → 1개, `#` 제거 빼기 → 2개 실패
- `npx tsc --noEmit` ✅ / `npx eslint .` ✅ / `npx next build` ✅(`/admin/redirects` 생김, 공개 경로 모두 ƒ 동적 그대로, "Dynamic server usage" 로그는 기존과 같음)
- 실제 PostgREST·proxy 동작은 미리보기·운영에서 확인 필요(이 PC에 `.env.local` 없음)

### 배포할 때(사용자 승인 후)

1. 운영 DB 백업 → **020 적용**(`begin;`/`commit;`). 테이블·함수 추가만이라 지금 코드와 함께 동작
2. 머지 → 자동 배포 → `/admin/redirects`(빈 목록) 확인, 아무 랜딩 200 확인
3. 이동 넣기는 별도 운영 작업: 대표 다시 고르기(noindex된 대표 26묶음) → 목록·개수 보고 → 승인 → SQL 한 트랜잭션 → 옛 주소 301·sitemap 빠짐 확인

### 남은 것

- 관리자가 나중에 옛 주소와 같은 slug로 새 페이지를 만들면 이동이 먼저 적용되어 새 페이지가 안 보임(관리자 화면 "옛 페이지 공개"로만 보임). 필요하면 slug 검사에 이동 목록 추가
- 대표(새 주소) 페이지의 slug를 바꾸면 이동이 깨짐 → 관리자 화면에 "새 주소에 페이지가 없음"으로 표시
- 백업 파일(version 4)에 이동 목록은 들어가지 않음

### 운영 배포 ✅ (2026-10-30, 사용자 "머지해" + 020 적용 권한 승인)

| 순서 | 작업 | 결과 |
| --- | --- | --- |
| 1 | 운영 DB 백업(SELECT만) | `C:\Users\user\Documents\onecare-backup\2026-10-30_redirects-deploy\` — 15개 테이블 전부 받기 전 = 받은 뒤 = 저장 행 수 = 고유 키(landing_pages 1,230, seo 549, queue 183, faqs 561, events 663, 수집 체크 113 등) + `schema.json`(칸 150·제약 97·인덱스 35·트리거 4·함수 7·정책 39) + Storage 36개(46,212,870 B) |
| 2 | 020 사전 점검 | 테이블·함수 없음, `landing_pages.slug` unique 있음, main = `a9d20a4` |
| 2 | migration 020 | `apply-020.sql`(`begin;` + 커밋 `eb3e66c`의 020 + `commit;`) ✅. RLS 켜짐, 정책 1개(anon·authenticated SELECT), 트리거 `landing_page_redirects_check`, 제약 5개, 0행. anon 읽기 됨·추가는 권한 오류(롤백 트랜잭션, 남은 행 0). 기존 행 수 그대로, 사이트 200 |
| 3 | 배포 전 운영 | `a9d20a4`(사진 기능 배포) ← 되돌리기용 |
| 3 | 머지 | [PR #3](https://github.com/backhabin0/onecarelandingprogram/pull/3) merge commit **`fabc34f`** → GitHub deployment 7429595808 Production **success**(`onecarelandingprogram-3d83rzhwd-habin-s-projects.vercel.app`) |
| 4 | 배포 후 확인(GET) | `/`·랜딩 2개·`/llms.txt`·`/robots.txt`·`/login` 200, `/admin`·`/admin/redirects` 307 → `/login`, 없는 주소 404, 허브 3개(bucheon·dangjin·gunpo) 200, sitemap 873개(변화 없음), noindex 페이지 `noindex, follow` 그대로. 설명 맨 앞 `#` 사라짐(`siheung-jeongwangdong-window-cleaning-0004` "정왕동유리창청소, …", `suwon-gwonseondong-septic-blockage-06-0001` meta·JSON-LD 모두 "권선동정화조막힘, …") |

- 이동 목록이 비어 있어 실제 301은 아직 확인 못 함 → 첫 이동을 넣는 운영 작업 때 옛 주소 301·Location·sitemap 빠짐을 확인할 것
- 로그인한 관리자 화면 "주소 이동"은 계정이 없어 Claude가 열어보지 않음 → 사용자 확인(빈 목록 "이동 목록이 비어 있습니다." 보이면 정상)
- 되돌리기: Vercel에서 `a9d20a4` 배포로 promote. 020은 추가만이라 이전 코드와 함께 동작(DB까지 되돌릴 때만 `supabase/rollback/020_down.sql`)

### 이동 넣기 1차 10건 ✅ (2026-10-30, 사용자 승인)

- 대표 다시 고르기 규칙(사용자 결정): 묶음 안에 noindex 아니고 방문 기록 있는 페이지가 있으면 그걸 대표로, 없으면 묶음 전체 noindex(이동 안 넣음) → noindex된 대표 26묶음은 전부 "전체 noindex"(남은 32개 모두 방문·클릭 0). A·B 반대 방향 4쌍은 원본을 대표로, A·D 겹친 10묶음은 하나로 합침(의미 없는 주소가 대표인 `fhghhdgh12`·`zcxv11`은 클릭이 있어 그대로 두기로 함)
- 전체 계획: 이동 178건(A 5 · B 5 · A+D 30 · D 138) + 추가 noindex 32개 → sitemap 873 → 663 예상
- 1차 10건(B 2·A 2·A+D 2·D 4): 백업 `C:\Users\user\Documents\onecare-backup\2026-10-30_redirects-batch1\`(before.json·batch.tsv·insert.sql·rollback.sql·sitemap 전후·확인 결과)
- 확인: 옛 주소 10개 모두 301 + Location 새 주소(쿼리 유지, HEAD·Yeti UA 동일), 새 주소 200·`index, follow`·자기 canonical, sitemap 873 → 863(옛 주소 10개만 빠지고 나머지 lastmod 그대로), llms.txt·허브·관련 링크에서 옛 주소 0(정왕동 정화조 페이지의 옛 주소 링크 사라짐), 이동 10행 모두 새 주소 공개·noindex 아님·연쇄 없음
- 되돌리기: `rollback.sql`(이 10건만 삭제)
- 남은 것: 2차(나머지 168건 + noindex 32개)는 사용자 승인 후 → 그 다음 IndexNow로 sitemap 알리기
