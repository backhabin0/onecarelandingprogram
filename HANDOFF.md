# HANDOFF — feature/bulk-publish

마지막 업데이트: 2026-10-23

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

## 다음 단계

1. bulk publish(대량 생성·공개) 기능 본 작업
2. 3단계 전: 테스트 DB를 마련해서 1,000행 넘는 실제 데이터로 sitemap, 관리자 목록, 대시보드, 통계, CSV, 백업·복구 재확인
   - 백업·복구(`lib/backup/restore.ts`)는 아직 모의 테스트가 없음. 테스트 DB 확인 때 같이 볼 것
