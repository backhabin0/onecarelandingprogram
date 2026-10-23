/**
 * 대량 등록·공개 대기열 화면 컴포넌트 테스트(정적 렌더링 결과 확인).
 * 브라우저 상호작용(파일 선택, 버튼 클릭)은 다루지 않는다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";
import type { CheckedUploadRow } from "@/lib/bulk-upload/check";
import type { LandingPageQueueRow } from "@/types/publish-queue";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/queue",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { default: AdminSidebar } = await import("@/components/admin/AdminSidebar");
const { default: BulkCheckResultTable } = await import("@/components/admin/BulkCheckResultTable");
const { default: BulkUploadPanel } = await import("@/components/admin/BulkUploadPanel");
const { default: PromptBuilderPanel } = await import("@/components/admin/PromptBuilderPanel");
const { default: QueueStateTabs } = await import("@/components/admin/QueueStateTabs");
const { default: QueueTable } = await import("@/components/admin/QueueTable");
const { default: QueueItemForm } = await import("@/components/admin/QueueItemForm");
const { default: SimilaritySettingsPanel } = await import("@/components/admin/SimilaritySettingsPanel");
const { default: AutoPublishSettingsPanel } = await import("@/components/admin/AutoPublishSettingsPanel");
const { default: PublishedUrlsPanel } = await import("@/components/admin/PublishedUrlsPanel");
const { default: AdminQueuePage } = await import("@/app/admin/queue/page");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function checkedRow(rowNumber: number, patch: Partial<CheckedUploadRow> = {}): CheckedUploadRow {
  return {
    rowNumber,
    status: "pass",
    errors: [],
    warnings: [],
    similarity: null,
    holdable: false,
    queueRow: {
      region: "강남",
      keyword: "헬스장",
      region_slug: "gangnam",
      keyword_slug: "gym",
      business_name: "원케어",
      title: "강남 헬스장",
      slug: "gangnam-gym",
      hero_text: null,
      description: null,
      phone: null,
      kakao_url: null,
      address: null,
      template: "template-a",
      seo_title: null,
      seo_description: null,
      faqs: [],
      city: null,
      city_slug: null,
      main_image_url: null,
      main_image_alt: null,
      case_study: null,
      max_similarity: null,
    },
    ...patch,
  };
}

function queueItem(patch: Partial<LandingPageQueueRow>): LandingPageQueueRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    region: "강남",
    keyword: "헬스장",
    region_slug: "gangnam",
    keyword_slug: "gym",
    business_name: "원케어",
    title: "강남 헬스장",
    slug: "gangnam-gym",
    hero_text: null,
    description: null,
    phone: null,
    kakao_url: null,
    address: null,
    template: "template-a",
    seo_title: null,
    seo_description: null,
    service_area: null,
    business_category: null,
    faqs: [],
    city: null,
    city_slug: null,
    main_image_url: null,
    main_image_alt: null,
    case_study: null,
    source: "excel",
    state: "ready",
    validation_errors: [],
    max_similarity: null,
    priority: 0,
    published_at: null,
    landing_page_id: null,
    batch_id: null,
    created_at: "2026-10-01T00:00:00.000Z",
    ...patch,
  };
}

describe("관리자 메뉴", () => {
  it("'AI 대량 생성'과 '공개 대기열'이 기존 메뉴와 같은 모양으로 들어 있다", () => {
    const html = renderToStaticMarkup(<AdminSidebar />);
    expect(html).toContain('href="/admin/bulk"');
    expect(html).toContain('href="/admin/queue"');
    expect(text(html)).toMatch(/새 페이지 만들기 AI 대량 생성 공개 대기열 상담 관리/);
    // 현재 경로(/admin/queue)는 활성 스타일
    expect(html).toMatch(/class="[^"]*bg-blue-600[^"]*" href="\/admin\/queue"/);
    expect(html).not.toMatch(/class="[^"]*bg-blue-600[^"]*" href="\/admin\/bulk"/);
  });
});

describe("검사 결과 표", () => {
  it("행 번호·결과·유사도·오류/경고 문구를 보여준다", () => {
    const html = renderToStaticMarkup(
      <BulkCheckResultTable
        rows={[
          checkedRow(2),
          checkedRow(5, {
            status: "error",
            holdable: true,
            similarity: { score: 0.8734, label: "기존 페이지 /seocho-gym" },
            errors: [{ code: "similarity_too_high", fields: [], message: "문구가 87% 비슷합니다." }],
          }),
          checkedRow(7, {
            status: "warning",
            warnings: [{ code: "slug_normalized", fields: [], message: "URL을 바꿔 저장합니다." }],
          }),
        ]}
      />
    );
    const t = text(html);
    expect(html).toContain('data-row="2"');
    expect(t).toContain("5 오류 보류 저장 가능");
    expect(t).toContain("87% 기존 페이지 /seocho-gym");
    expect(t).toContain("문구가 87% 비슷합니다.");
    expect(t).toContain("7 경고");
    expect(t).toContain("/gangnam-gym");
  });

  it("행이 없으면 안내 문구", () => {
    expect(text(renderToStaticMarkup(<BulkCheckResultTable rows={[]} />))).toContain("해당하는 행이 없습니다.");
  });
});

describe("대량 등록 화면", () => {
  it("양식 다운로드 링크, 파일 선택(xlsx/csv), 표 붙여넣기 칸", () => {
    const html = renderToStaticMarkup(<BulkUploadPanel />);
    expect(html).toContain('href="/admin/bulk/template"');
    expect(html).toContain('accept=".xlsx,.csv"');
    expect(text(html)).toContain("1. 파일 올리기");
    expect(html).toContain('id="bulkPasteText"');
    expect(text(html)).toContain("붙여넣은 표 검사");
  });

  it("프롬프트 만들기: 지역·키워드·업체 정보 입력과 안내(아직 입력 전)", () => {
    const html = renderToStaticMarkup(<PromptBuilderPanel />);
    const t = text(html);
    expect(html).toContain('id="promptRegions"');
    expect(html).toContain('id="promptKeywords"');
    for (const id of ["promptBusinessName", "promptPhone", "promptKakao", "promptAddress", "promptTemplate", "promptIndustry"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(t).toContain("지역 0개 × 키워드 0개 = 0개 조합");
    expect(t).toContain("지역과 키워드를 입력하면 프롬프트가 만들어집니다.");
    // 이 화면은 AI를 직접 호출하지 않는다(서버 액션·외부 요청 없음)
    expect(html).not.toMatch(/api\.anthropic|openai/i);
  });
});

describe("공개 대기열 화면", () => {
  it("상태 탭: 건수, 현재 탭 표시, 검색어 유지", () => {
    const html = renderToStaticMarkup(
      <QueueStateTabs
        current="hold"
        search="강남"
        counts={{ all: 10, ready: 5, hold: 3, draft: 0, failed: 1, published: 1 }}
      />
    );
    expect(text(html)).toMatch(/전체 10 공개 대기 5 보류 3 초안 0 실패 1 공개됨 1/);
    expect(html).toMatch(/aria-current="page"[^>]*>보류/);
    expect(html).toContain('href="/admin/queue?state=hold&amp;search=%EA%B0%95%EB%82%A8"');
    expect(html).toContain('href="/admin/queue?search=%EA%B0%95%EB%82%A8"');
  });

  it("목록: 상태별 버튼(보류는 공개 대기로, 공개됨은 페이지 보기만), 확인 사항 색", () => {
    const html = renderToStaticMarkup(
      <QueueTable
        isFiltered={false}
        items={[
          queueItem({
            state: "hold",
            max_similarity: 0.85,
            validation_errors: [
              { code: "similarity_too_high", message: "너무 비슷함", level: "error" },
              { code: "slug_normalized", message: "URL 변경", level: "warning" },
            ],
          }),
          queueItem({
            id: "00000000-0000-4000-8000-000000000002",
            slug: "seocho-gym",
            region: "서초",
            state: "published",
            landing_page_id: "00000000-0000-4000-8000-0000000000aa",
            published_at: "2026-10-02T00:00:00.000Z",
            validation_errors: [{ code: "slug_conflict", message: "이미 사용 중인 URL입니다." }],
          }),
        ]}
      />
    );
    const t = text(html);
    expect(t).toContain("보류");
    expect(t).toContain("85%");
    expect(t).toContain("공개 대기로");
    expect(html).toContain('href="/admin/queue/00000000-0000-4000-8000-000000000001/edit"');
    expect(html).toContain('href="/admin/pages/00000000-0000-4000-8000-0000000000aa/edit"');
    expect(html).not.toContain('href="/admin/queue/00000000-0000-4000-8000-000000000002/edit"');
    expect(html).toMatch(/text-red-700">너무 비슷함/);
    expect(html).toMatch(/text-amber-700">URL 변경/);
    // level이 없는 기록(공개 함수의 slug 충돌)은 오류로 표시
    expect(html).toMatch(/text-red-700">이미 사용 중인 URL입니다\./);
    // 공개된 항목에는 선택 체크박스가 없다
    expect(html).toContain('aria-label="강남 헬스장 선택"');
    expect(html).not.toContain('aria-label="서초 헬스장 선택"');
  });

  it("빈 목록 안내(필터 여부에 따라)", () => {
    expect(text(renderToStaticMarkup(<QueueTable items={[]} isFiltered={false} />))).toContain("대기열이 비어 있습니다");
    expect(text(renderToStaticMarkup(<QueueTable items={[]} isFiltered />))).toContain("조건에 맞는 항목이 없습니다");
  });

  it("수정 폼: 기존 값과 상태 선택(초안·공개 대기·보류만)", () => {
    const html = renderToStaticMarkup(
      <QueueItemForm
        id="00000000-0000-4000-8000-000000000001"
        currentState="failed"
        initialValues={{ region: "강남", keyword: "헬스장", businessName: "원케어", template: "template-b", faqQuestion1: "주차?" }}
      />
    );
    expect(html).toContain('value="강남"');
    expect(html).toContain('value="주차?"');
    expect(html).toMatch(/<option value="template-b" selected="">/);
    expect(text(html)).toContain("공개에 실패한 항목입니다");
    const options = Array.from(html.matchAll(/<option value="(ready|hold|draft|published|failed)"/g)).map((m) => m[1]);
    expect(options).toEqual(["ready", "hold", "draft"]);
    // 글자 수 제한은 공용 상수
    expect(html).toMatch(/id="queue-businessName"[^>]*maxLength="100"/);
  });

  it("설정: 매일 자동 공개(켜기·하루 개수·지금 실행·실행 기록·IndexNow)", () => {
    const html = renderToStaticMarkup(
      <AutoPublishSettingsPanel
        enabled
        dailyLimit={30}
        noindexThinPages={false}
        limitRange={{ min: 1, max: 100 }}
        runs={[
          { id: "r1", run_date: "2026-10-23", published_count: 30, failed_count: 2, finished_at: "2026-10-23T00:00:05.000Z", trigger: "cron" },
        ]}
        indexNow={{
          configured: true,
          detail: "https://onecare.example/key.txt",
          pendingCount: 5,
          recent: [{ created_at: "2026-10-23T00:01:00.000Z", trigger: "admin", url_count: 30, success: false, status_code: 429, error: "HTTP 429" }],
        }}
        loadError={null}
      />
    );
    const t = text(html);
    expect(html).toMatch(/id="autoPublishEnabled"[^>]*checked=""/);
    expect(html).toMatch(/id="autoPublishDailyLimit"[^>]*max="100"[^>]*value="30"/);
    expect(t).toContain("지금 1회 실행");
    expect(t).toMatch(/2026-10-23 자동 30 2/);
    expect(t).toMatch(/아직 알리지 않은 공개 페이지 5 ?개/);
    expect(t).toContain("키 파일: https://onecare.example/key.txt");
    expect(t).toContain("실패: HTTP 429");
  });

  it("오늘 공개된 주소: 한 줄에 하나, 전체 복사, 날짜 선택(오늘까지)", () => {
    const html = renderToStaticMarkup(
      <PublishedUrlsPanel
        date="2026-10-23"
        today="2026-10-23"
        urls={["https://onecare.example/a", "https://onecare.example/b"]}
        error={null}
        baseParams={{}}
      />
    );
    expect(text(html)).toMatch(/오늘 공개된 주소 2개/);
    expect(html).toContain("https://onecare.example/a\nhttps://onecare.example/b");
    expect(html).toMatch(/id="publishedDate"[^>]*max="2026-10-23"[^>]*value="2026-10-23"/);
    expect(text(html)).toContain("전체 복사");

    const past = renderToStaticMarkup(
      <PublishedUrlsPanel date="2026-10-20" today="2026-10-23" urls={[]} error={null} baseParams={{}} />
    );
    expect(text(past)).toContain("2026-10-20 공개된 주소");
    expect(text(past)).toContain("이 날 공개된 페이지가 없습니다.");
  });

  it("설정: 유사도 기준값 입력", () => {
    const html = renderToStaticMarkup(
      <SimilaritySettingsPanel initialThresholds={{ warning: 0.6, error: 0.8 }} loadError={null} />
    );
    expect(html).toMatch(/id="similarityWarning"[^>]*value="0.6"/);
    expect(html).toMatch(/id="similarityError"[^>]*value="0.8"/);
  });
});

describe("공개 대기열 페이지(PGlite 데이터로 렌더링)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createMigratedDb();
    await db.query(
      `insert into public.landing_page_queue
         (region, keyword, region_slug, keyword_slug, business_name, title, slug, source, state, created_at)
       select '지역' || i, '헬스장', 'region-' || i, 'gym', '업체 ' || i, '제목 ' || i, 'region-' || i || '-gym',
              'excel', case when i % 10 = 0 then 'hold' else 'ready' end,
              timestamptz '2026-10-01' + make_interval(secs => i)
         from generate_series(0, 119) as i`
    );
    setFakeSupabase(new PgliteSupabase(db));
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  it("120개 → 50개씩 3페이지, 탭 건수", async () => {
    const html = renderToStaticMarkup(await AdminQueuePage({ searchParams: Promise.resolve({ page: "3" }) }));
    const t = text(html);
    expect(t).toContain("3 / 3 페이지");
    expect(t).toMatch(/전체 120 공개 대기 108 보류 12/);
    expect(html).toContain("/region-100-gym");
    expect(html).not.toContain("/region-99-gym<");
  });

  it("보류 탭 + 검색", async () => {
    const html = renderToStaticMarkup(
      await AdminQueuePage({ searchParams: Promise.resolve({ state: "hold", search: "지역1" }) })
    );
    const slugs = Array.from(html.matchAll(/\/(region-\d+-gym)</g)).map((m) => m[1]);
    expect(slugs).toEqual(["region-10-gym", "region-100-gym", "region-110-gym"]);
  });
});
