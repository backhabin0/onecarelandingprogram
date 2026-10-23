/**
 * 7단계: 지역 SEO — 머리말(H1·제목), 사진 alt, 내부 링크 선정, 지역 모음 페이지, 경로,
 * 구조화 데이터(JSON-LD) 유효성, 템플릿 A/B의 H1 개수, KST 날짜 경계, 이미지 최적화 기준.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LandingPage } from "@/types/landing-page";
import {
  buildAreaHubs,
  buildHeadline,
  buildImageAlt,
  buildPageBreadcrumbs,
  selectRelatedLinks,
  type HubPageEntry,
  type RelatedCandidate,
} from "@/lib/local-seo";
import { isValidDateString, kstDateOf, kstDayRange } from "@/lib/kst-date";
import { isOptimizableImageUrl } from "@/lib/landing-images";
import { buildBreadcrumbJsonLd, buildFaqPageJsonLd, buildOrganizationJsonLd, buildWebPageJsonLd } from "@/lib/structured-data";
import { resolveLandingPageSeo } from "@/lib/seo-resolver";
import { buildSeoTitle } from "@/lib/seo-auto";
import { safeJsonLdString } from "@/lib/json-ld";
import { FakeSupabase } from "./helpers/fake-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const { default: LandingPageRenderer } = await import("@/components/landing/LandingPageRenderer");
const { default: AreaHubPage, generateMetadata: hubMetadata } = await import("@/app/area/[citySlug]/page");
const { getRelatedLinks } = await import("@/lib/local-pages");

function page(overrides: Partial<LandingPage> = {}): LandingPage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    business_name: "원케어 헬스",
    title: "원케어 헬스 산본점",
    slug: "sanbon-gym",
    hero_text: "퇴근길 운동",
    description: "산본동 아파트 단지 주민을 위한 소규모 운동 공간입니다.",
    phone: "031-123-4567",
    kakao_url: null,
    address: "경기 군포시 산본로 1",
    logo_url: null,
    main_image_url: null,
    template: "template-a",
    status: "public",
    published_at: "2026-10-23T00:00:00.000Z",
    region: "산본동",
    keyword: "헬스장",
    city: "군포시",
    city_slug: "gunpo",
    main_image_alt: null,
    case_study: null,
    created_at: "2026-10-23T00:00:00.000Z",
    updated_at: "2026-10-23T00:00:00.000Z",
    ...overrides,
  };
}

const faqs = [
  { question: "주차 되나요?", answer: "네, 건물 지하 주차장을 이용할 수 있습니다." },
  { question: "처음인데 괜찮을까요?", answer: "상담 후 맞는 방법을 안내해 드립니다." },
];

/** 렌더링된 HTML에서 JSON-LD를 모두 꺼내 JSON으로 파싱한다(파싱 실패면 예외 → 테스트 실패) */
function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return Array.from(html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)).map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>
  );
}

describe("머리말(H1·자동 SEO 제목)", () => {
  it.each([
    ["원케어 헬스", "산본동 헬스장 원케어 헬스"],
    ["산본동 헬스장 원케어", "산본동 헬스장 원케어"],
    ["헬스장 원케어", "산본동 헬스장 원케어"],
    ["산본동 원케어", "산본동 헬스장 원케어"],
    ["원케어 산본동 지점", "산본동 헬스장 원케어 지점"],
  ])("제목 %j → %j", (title, expected) => {
    expect(buildHeadline(title, "산본동", "헬스장")).toBe(expected);
  });

  it("지역·키워드가 없으면(직접 만든 페이지) 제목 그대로", () => {
    expect(buildHeadline("원케어 헬스", null, "헬스장")).toBe("원케어 헬스");
    expect(buildSeoTitle(page({ region: null, keyword: null, title: "원케어" }))).toBe("원케어 | 원케어 헬스");
  });

  it("자동 SEO 제목은 '지역 키워드'가 맨 앞", () => {
    expect(buildSeoTitle(page({ title: "원케어 헬스" }))).toBe("산본동 헬스장 원케어 헬스 | 원케어 헬스");
  });
});

describe("사진 alt", () => {
  it("입력값 → '지역 키워드 현장' → '업체명 대표 이미지'", () => {
    expect(buildImageAlt(page({ main_image_alt: " 산본동 헬스장 내부 " }))).toBe("산본동 헬스장 내부");
    expect(buildImageAlt(page())).toBe("산본동 헬스장 현장");
    expect(buildImageAlt(page({ region: null }))).toBe("원케어 헬스 대표 이미지");
  });
});

describe("내부 링크 선정", () => {
  const cand = (slug: string, region: string, keyword: string, extra: Partial<RelatedCandidate> = {}): RelatedCandidate => ({
    slug,
    title: `${region} ${keyword}`,
    business_name: "원케어",
    region,
    keyword,
    city: "군포시",
    city_slug: "gunpo",
    noindex: false,
    ...extra,
  });
  const current = page();

  it("같은 지역 다른 서비스: 같은 시/군·같은 지역, 키워드 다름, 최대 5개(가나다순), 자기 자신·noindex·키워드 중복 제외", () => {
    const candidates = [
      current as unknown as RelatedCandidate,
      cand("sanbon-yoga", "산본동", "요가"),
      cand("sanbon-pilates", "산본동", "필라테스"),
      cand("sanbon-pt", "산본동", "PT"),
      cand("sanbon-swim", "산본동", "수영"),
      cand("sanbon-boxing", "산본동", "복싱"),
      cand("sanbon-climb", "산본동", "클라이밍"),
      cand("sanbon-yoga-2", "산본동", "요가"), // 키워드 중복
      cand("sanbon-dance", "산본동", "댄스", { noindex: true }),
      cand("other-city-sanbon", "산본동", "골프", { city_slug: "other", city: "다른시" }),
    ].map((c) => ({ ...c, noindex: c.noindex ?? false }));
    const { sameRegion } = selectRelatedLinks(current, candidates);
    // 한국어 정렬: 한글 가나다순 뒤에 영문(PT) → 6개 중 앞 5개
    expect(sameRegion.map((l) => l.href)).toEqual([
      "/sanbon-boxing",
      "/sanbon-swim",
      "/sanbon-yoga",
      "/sanbon-climb",
      "/sanbon-pilates",
    ]);
    expect(sameRegion[0].label).toBe("산본동 복싱");
  });

  it("근처 지역 같은 서비스: 같은 시/군·같은 키워드·다른 지역, 현재 지역 다음부터 돌아가며 최대 5개", () => {
    const regions = ["궁내동", "금정동", "당동", "대야미동", "부곡동", "수리동", "오금동", "재궁동"];
    const candidates = regions.map((r, i) => cand(`r${i}-gym`, r, "헬스장"));
    // "산본동"은 가나다순으로 부곡동과 수리동 사이 → 수리동부터
    const { nearby } = selectRelatedLinks(current, candidates);
    expect(nearby.map((l) => l.label)).toEqual([
      "수리동 헬스장",
      "오금동 헬스장",
      "재궁동 헬스장",
      "궁내동 헬스장",
      "금정동 헬스장",
    ]);
    // 다른 키워드·다른 시/군·noindex는 제외
    const mixed = [
      cand("x1", "수리동", "요가"),
      cand("x2", "수리동", "헬스장", { city_slug: "anyang", city: "안양시" }),
      cand("x3", "수리동", "헬스장", { noindex: true }),
    ];
    expect(selectRelatedLinks(current, mixed).nearby).toEqual([]);
  });

  it("지역 모음 링크는 시/군이 있을 때만", () => {
    expect(selectRelatedLinks(current, []).hub).toEqual({ href: "/area/gunpo", label: "군포시 지역 모음" });
    expect(selectRelatedLinks(page({ city: null, city_slug: null }), []).hub).toBeNull();
  });

  it("DB 조회(getRelatedLinks): 공개 페이지만 후보, noindex 제외", async () => {
    const row = (slug: string, region: string, keyword: string, status = "public") => ({
      id: slug,
      slug,
      title: `${region} ${keyword}`,
      business_name: "원케어",
      region,
      keyword,
      city: "군포시",
      city_slug: "gunpo",
      status,
    });
    setFakeSupabase(
      new FakeSupabase({
        tables: {
          landing_pages: [
            row("sanbon-gym", "산본동", "헬스장"),
            row("sanbon-yoga", "산본동", "요가"),
            row("sanbon-private", "산본동", "필라테스", "private"),
            row("sanbon-noindex", "산본동", "복싱"),
            row("suri-gym", "수리동", "헬스장"),
          ],
          landing_page_seo_settings: [{ landing_page_id: "sanbon-noindex", seo_noindex: true }],
        },
        relations: {
          landing_pages: { landing_page_seo_settings: { kind: "one", localKey: "id", foreignKey: "landing_page_id" } },
        },
      })
    );
    const links = await getRelatedLinks(page());
    expect(links.sameRegion.map((l) => l.href)).toEqual(["/sanbon-yoga"]);
    expect(links.nearby.map((l) => l.href)).toEqual(["/suri-gym"]);
    expect(links.hub?.href).toBe("/area/gunpo");
  });
});

describe("지역 모음 페이지", () => {
  const entry = (slug: string, overrides: Partial<HubPageEntry> = {}): HubPageEntry => ({
    slug,
    title: slug,
    region: "산본동",
    keyword: "헬스장",
    city: "군포시",
    city_slug: "gunpo",
    updated_at: "2026-10-20T00:00:00.000Z",
    published_at: "2026-10-21T00:00:00.000Z",
    created_at: "2026-10-01T00:00:00.000Z",
    noindex: false,
    ...overrides,
  });

  it("시/군별로 묶고 키워드별·지역 가나다순, noindex·시/군 없는 페이지 제외, 1개 이상인 시/군만", () => {
    const hubs = buildAreaHubs([
      entry("a", { region: "수리동" }),
      entry("b", { region: "궁내동" }),
      entry("c", { keyword: "요가", updated_at: "2026-10-23T05:00:00.000Z" }),
      entry("d", { noindex: true }),
      entry("e", { city: null, city_slug: null }),
      entry("f", { city: "안양시", city_slug: "anyang", noindex: true }),
    ]);
    expect(hubs).toHaveLength(1);
    expect(hubs[0]).toMatchObject({ city: "군포시", citySlug: "gunpo", pageCount: 3 });
    expect(hubs[0].groups).toEqual([
      { keyword: "요가", pages: [{ href: "/c", label: "산본동 요가", region: "산본동" }] },
      {
        keyword: "헬스장",
        pages: [
          { href: "/b", label: "궁내동 헬스장", region: "궁내동" },
          { href: "/a", label: "수리동 헬스장", region: "수리동" },
        ],
      },
    ]);
    expect(hubs[0].lastModified.toISOString()).toBe("2026-10-23T05:00:00.000Z");
  });

  function hubDb(rows: Record<string, unknown>[], seo: Record<string, unknown>[] = []) {
    return new FakeSupabase({
      tables: { landing_pages: rows, landing_page_seo_settings: seo },
      relations: {
        landing_pages: { landing_page_seo_settings: { kind: "one", localKey: "id", foreignKey: "landing_page_id" } },
      },
    });
  }
  const hubRow = (slug: string, region: string, keyword: string, status = "public") => ({
    id: slug,
    slug,
    title: `${region} ${keyword} 원케어`,
    business_name: "원케어 헬스",
    region,
    keyword,
    city: "군포시",
    city_slug: "gunpo",
    status,
    updated_at: "2026-10-20T00:00:00.000Z",
    published_at: "2026-10-21T00:00:00.000Z",
    created_at: "2026-10-01T00:00:00.000Z",
  });

  it("/area/gunpo: H1 1개, 키워드별 링크, ItemList JSON-LD, 메타데이터. 경로·BreadcrumbList·홈 링크 없음", async () => {
    setFakeSupabase(hubDb([hubRow("sanbon-gym", "산본동", "헬스장"), hubRow("suri-gym", "수리동", "헬스장"), hubRow("hidden", "당동", "헬스장", "private")]));
    const html = renderToStaticMarkup(await AreaHubPage({ params: Promise.resolve({ citySlug: "gunpo" }) }));
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('href="/sanbon-gym"');
    expect(html).toContain('href="/suri-gym"');
    expect(html).not.toContain("/hidden");
    const blocks = jsonLdBlocks(html);
    // "홈"을 빼면 경로가 "시/군" 1개뿐이라 경로 표시·BreadcrumbList(2개 이상 필요)를 넣지 않는다.
    expect(blocks.map((b) => b["@type"])).toEqual(["ItemList"]);
    expect(html).not.toMatch(/aria-label="현재 위치"/);
    expect(html).not.toContain('href="/"');
    expect(html).not.toContain(">홈<");
    expect((blocks[0].itemListElement as unknown[]).length).toBe(2);

    const meta = await hubMetadata({ params: Promise.resolve({ citySlug: "gunpo" }) });
    expect(meta.title).toBe("군포시 헬스장 지역 안내 | 원케어 헬스");
    expect(meta.alternates?.canonical).toBe("https://example.test/area/gunpo");
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("공개+noindex 아닌 페이지가 없으면 404(색인 제외 메타데이터)", async () => {
    setFakeSupabase(hubDb([hubRow("only", "산본동", "헬스장")], [{ landing_page_id: "only", seo_noindex: true }]));
    await expect(AreaHubPage({ params: Promise.resolve({ citySlug: "gunpo" }) })).rejects.toThrow("NOT_FOUND");
    expect((await hubMetadata({ params: Promise.resolve({ citySlug: "gunpo" }) })).robots).toEqual({ index: false, follow: false });
    await expect(AreaHubPage({ params: Promise.resolve({ citySlug: "Bad_Slug" }) })).rejects.toThrow("NOT_FOUND");
  });
});

describe("공개 페이지 렌더링(템플릿 A/B)", () => {
  const render = (overrides: Partial<LandingPage>, related = null) => {
    const landingPage = page(overrides);
    return renderToStaticMarkup(
      <LandingPageRenderer
        landingPage={landingPage}
        faqs={faqs}
        resolvedSeo={resolveLandingPageSeo(landingPage, null)}
        related={related}
      />
    );
  };

  it.each(["template-a", "template-b"])("%s: H1은 1개이고 '지역 키워드'가 앞쪽", (template) => {
    const html = render({ template, title: "원케어 헬스" });
    const h1s = Array.from(html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)).map((m) => m[1]);
    expect(h1s).toEqual(["산본동 헬스장 원케어 헬스"]);
  });

  it.each(["template-a", "template-b"])("%s: 사진 alt 자동 생성, 사진 없으면 이미지 없이 렌더링", (template) => {
    const withImage = render({ template, main_image_url: "https://img.example/a.jpg" });
    expect(withImage).toMatch(/<img[^>]*alt="산본동 헬스장 현장"/);
    const withoutImage = render({ template, main_image_url: null });
    expect(withoutImage).not.toMatch(/<img[^>]*alt="산본동 헬스장 현장"/);
  });

  it.each(["template-a", "template-b"])("%s: 현장 사례가 있으면 '현장 사례' 섹션", (template) => {
    expect(render({ template, case_study: "지난주 수리동 아파트 현장에서..." })).toContain("현장 사례");
    expect(render({ template, case_study: null })).not.toContain("현장 사례");
  });

  it("경로(군포시 › 페이지)와 내부 링크가 화면에 보인다", () => {
    const html = render({}, {
      sameRegion: [{ href: "/sanbon-yoga", label: "산본동 요가" }],
      nearby: [{ href: "/suri-gym", label: "수리동 헬스장" }],
      hub: { href: "/area/gunpo", label: "군포시 지역 모음" },
    } as never);
    expect(html).toMatch(/aria-label="현재 위치"/);
    expect(html).toContain('href="/area/gunpo"');
    expect(html).toContain("같은 지역 다른 서비스");
    expect(html).toContain("근처 지역 같은 서비스");
    expect(html).toContain('href="/suri-gym"');
  });

  it("구조화 데이터: 모두 유효한 JSON이고 WebPage·LocalBusiness(areaServed)·FAQPage·BreadcrumbList", () => {
    const blocks = jsonLdBlocks(render({}));
    expect(blocks.map((b) => b["@type"])).toEqual(["WebPage", "LocalBusiness", "FAQPage", "BreadcrumbList"]);
    for (const b of blocks) expect(b["@context"]).toBe("https://schema.org");

    const business = blocks[1];
    expect(business.areaServed).toEqual({ "@type": "AdministrativeArea", name: "군포시 산본동" });
    const faq = blocks[2] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(faqs.map((f) => f.question));
    const crumbs = blocks[3] as { itemListElement: { position: number; name: string; item: string }[] };
    expect(crumbs.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "군포시", item: "https://example.test/area/gunpo" },
      { "@type": "ListItem", position: 2, name: "산본동 헬스장 원케어 헬스 산본점", item: "https://example.test/sanbon-gym" },
    ]);
  });

  it.each(["template-a", "template-b"])("%s: 경로는 '시/군 › 페이지'로 시작하고 '홈'·사이트 루트 링크가 없다", (template) => {
    const html = render({ template });
    const nav = html.match(/<nav aria-label="현재 위치"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";
    const crumbs = Array.from(nav.matchAll(/<li[^>]*>(?:<a[^>]*>|<span[^>]*>)([^<]*)</g)).map((m) => m[1]);
    expect(crumbs).toEqual(["군포시", "산본동 헬스장 원케어 헬스 산본점"]);
    expect(nav).toContain('href="/area/gunpo"');
    expect(html).not.toContain('href="/"');
    expect(html).not.toContain(">홈<");
    const crumbLd = jsonLdBlocks(html).find((b) => b["@type"] === "BreadcrumbList") as { itemListElement: { name: string; item: string }[] };
    expect(crumbLd.itemListElement.map((i) => i.name)).toEqual(["군포시", "산본동 헬스장 원케어 헬스 산본점"]);
    expect(crumbLd.itemListElement.every((i) => i.item !== "https://example.test/")).toBe(true);
  });

  it.each(["template-a", "template-b"])("%s: 시/군이 없으면 경로 표시·BreadcrumbList를 생략한다(항목 1개)", (template) => {
    const html = render({ template, city: null, city_slug: null });
    expect(html).not.toMatch(/aria-label="현재 위치"/);
    expect(jsonLdBlocks(html).map((b) => b["@type"])).toEqual(["WebPage", "LocalBusiness", "FAQPage"]);
    expect(buildPageBreadcrumbs(page({ city: null, city_slug: null }), "제목")).toEqual([{ name: "제목", path: "/sanbon-gym" }]);
  });

  it("미리보기 모드는 JSON-LD·내부 링크를 출력하지 않는다", () => {
    const landingPage = page();
    const html = renderToStaticMarkup(
      <LandingPageRenderer landingPage={landingPage} faqs={faqs} mode="preview" related={{ sameRegion: [{ href: "/x", label: "x" }], nearby: [], hub: null }} />
    );
    expect(jsonLdBlocks(html)).toEqual([]);
    expect(html).not.toContain("같은 지역 다른 서비스");
  });

  it("SEO 설정의 서비스 지역이 있으면 areaServed는 그 글자, 시/군·지역이 없으면 생략", () => {
    const withManual = buildOrganizationJsonLd(page(), { ...resolveLandingPageSeo(page(), null), serviceArea: "군포 전역" });
    expect(withManual.areaServed).toBe("군포 전역");
    const none = page({ city: null, region: null, address: null });
    expect(buildOrganizationJsonLd(none, resolveLandingPageSeo(none, null))).not.toHaveProperty("areaServed");
  });

  it("JSON-LD 문자열은 </script>를 깨뜨리지 않는다(사용자 입력 포함)", () => {
    const evil = page({ title: "</script><script>alert(1)</script>" });
    const data = [
      buildWebPageJsonLd(evil, resolveLandingPageSeo(evil, null)),
      buildFaqPageJsonLd([{ question: "<b>q</b>", answer: "a & b" }]),
      buildBreadcrumbJsonLd(buildPageBreadcrumbs(evil, evil.title)),
    ];
    for (const d of data) {
      const s = safeJsonLdString(d);
      expect(s).not.toMatch(/<|>/);
      expect(JSON.parse(s)).toEqual(d);
    }
    expect(buildBreadcrumbJsonLd([{ name: "홈", path: "/" }])).toBeNull();
  });
});

describe("한국 날짜(KST) 경계", () => {
  it("한국 날짜 하루 = 전날 15:00Z ~ 당일 15:00Z", () => {
    expect(kstDayRange("2026-10-23")).toEqual({
      start: "2026-10-22T15:00:00.000Z",
      end: "2026-10-23T15:00:00.000Z",
    });
    expect(kstDayRange("2026-01-01")).toEqual({
      start: "2025-12-31T15:00:00.000Z",
      end: "2026-01-01T15:00:00.000Z",
    });
  });

  it("UTC 14:59는 그날, 15:00은 다음 날(한국)", () => {
    expect(kstDateOf(new Date("2026-10-22T14:59:59.999Z"))).toBe("2026-10-22");
    expect(kstDateOf(new Date("2026-10-22T15:00:00.000Z"))).toBe("2026-10-23");
  });

  it("날짜 형식 검사", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-2-3")).toBe(false);
    expect(() => kstDayRange("bad")).toThrow();
  });
});

describe("이미지 최적화 기준", () => {
  it("이 프로젝트 Supabase Storage 공개 경로(https)만 최적화, 나머지는 원본", () => {
    const supabase = "https://abcd.supabase.co";
    expect(isOptimizableImageUrl("https://abcd.supabase.co/storage/v1/object/public/landing-page-assets/a.jpg", supabase)).toBe(true);
    expect(isOptimizableImageUrl("https://abcd.supabase.co/storage/v1/object/sign/x.jpg", supabase)).toBe(false);
    expect(isOptimizableImageUrl("https://evil.example/storage/v1/object/public/a.jpg", supabase)).toBe(false);
    expect(isOptimizableImageUrl("http://abcd.supabase.co/storage/v1/object/public/a.jpg", supabase)).toBe(false);
    expect(isOptimizableImageUrl("https://abcd.supabase.co/storage/v1/object/public/a.jpg", undefined)).toBe(false);
  });
});
