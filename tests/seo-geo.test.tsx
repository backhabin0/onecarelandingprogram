/**
 * SEO·AEO·GEO: 공개 홈(/), robots, sitemap(홈·lastmod), /llms.txt, 구조화 데이터 일관성,
 * 기존 페이지의 제목형 업체명·주소 처리, FAQ 화면 = JSON-LD, 대량 생성 FAQ 규칙.
 * 가짜 Supabase(메모리)만 쓴다 — 운영 DB·네트워크 연결 없음.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LandingPage } from "@/types/landing-page";
import { FakeSupabase } from "./helpers/fake-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";
import {
  areaName,
  isDistinctBusinessName,
  looksLikePostalAddress,
  toPlainSummary,
  withTopicParticle,
} from "@/lib/business-info";
import { buildAutomaticFaqs, resolveLandingPageFaqs } from "@/lib/faq-resolver";
import { buildSeoDescription } from "@/lib/seo-auto";
import { resolveLandingPageSeo } from "@/lib/seo-resolver";
import { buildOrganizationJsonLd, buildWebPageJsonLd } from "@/lib/structured-data";
import { buildHomeContent, HOME_SERVICE_LINK_LIMIT } from "@/lib/site-home";
import { EMPTY_SITE_PROFILE, sanitizeSiteProfileInput, type SiteProfile } from "@/lib/site-profile";
import { collectFaqQuestionWarnings } from "@/lib/bulk-upload/check";
import { buildBulkPrompts } from "@/lib/bulk-upload/prompt";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const { default: HomePage, generateMetadata: homeMetadata } = await import("@/app/page");
const { default: sitemap } = await import("@/app/sitemap");
const { default: robots } = await import("@/app/robots");
const { GET: llmsTxt } = await import("@/app/llms.txt/route");
const { default: LandingPageRenderer } = await import("@/components/landing/LandingPageRenderer");

function page(overrides: Partial<LandingPage> = {}): LandingPage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    business_name: "원케어배관",
    title: "아랫집 천장 얼룩부터 원인 확인",
    slug: "gunpo-sanbon-leak-detection",
    hero_text: "천장 얼룩이 생겼다면",
    description: "산본동 아파트 아랫집 천장 얼룩이 생겼다면 누수 위치부터 확인합니다.",
    phone: null,
    kakao_url: null,
    address: null,
    logo_url: null,
    main_image_url: null,
    template: "template-a",
    status: "public",
    published_at: "2026-10-23T12:38:38.461Z",
    region: "군포시 산본동",
    keyword: "누수탐지",
    city: "군포시",
    city_slug: "gunpo",
    main_image_alt: null,
    case_study: null,
    image_2_url: null,
    image_2_alt: null,
    image_3_url: null,
    image_3_alt: null,
    created_at: "2026-10-23T12:38:38.461Z",
    updated_at: "2026-10-23T12:38:38.461Z",
    ...overrides,
  };
}

/** 운영 DB에서 본 기존 페이지 모양: 업체명·주소 칸에 제목형 문구, 설명에 해시태그 */
const legacy = () =>
  page({
    business_name: "경기도 시흥시 은행동하수구뚫는곳 배수불량·역류 해결하는 방법",
    title: "경기도 시흥시 은행동하수구뚫는곳 배수불량·역류 해결하는 방법",
    slug: "siheung-eunhaeng-drain-unclogging",
    address: "siheung-eunhaeng-drain-unclogging",
    phone: "010-2068-8782",
    kakao_url: "https://open.kakao.com/o/example",
    description: "배수가 느리면 배관 내부를 확인해야 합니다.\n\n\n#은행동하수구뚫는곳 #시흥하수구",
    published_at: null,
    region: null,
    keyword: null,
    city: null,
    city_slug: null,
  });

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return Array.from(html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)).map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>
  );
}

const profile = (overrides: Partial<SiteProfile> = {}): SiteProfile => ({
  businessName: "원케어배관",
  description: "누수탐지·배관청소·하수구 막힘을 점검합니다.",
  phone: "010-0000-0000",
  kakaoUrl: "https://open.kakao.com/o/site",
  logoUrl: null,
  updatedAt: "2026-10-24T01:00:00.000Z",
  ...overrides,
});

// ------------------------------------------------------------
// 가짜 DB: 대기열로 공개된 페이지(시/군·키워드 있음) + 기존 페이지 + 비공개·noindex
// ------------------------------------------------------------

type Row = Record<string, unknown>;
const pageRow = (slug: string, overrides: Row = {}): Row => ({
  id: slug,
  slug,
  title: `${slug} 제목`,
  business_name: "원케어배관",
  status: "public",
  region: null,
  keyword: null,
  city: null,
  city_slug: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  published_at: null,
  ...overrides,
});
const queued = (slug: string, city: string, citySlug: string, region: string, keyword: string, at: string) =>
  pageRow(slug, { region, keyword, city, city_slug: citySlug, published_at: at, created_at: at, updated_at: at });

function siteDb(options: { profile?: Row | null; extra?: Row[] } = {}) {
  const profileRow =
    options.profile === null
      ? []
      : [
          {
            id: "default",
            business_name: "원케어배관",
            description: "누수탐지·배관청소·하수구 막힘을 점검합니다.",
            phone: "010-0000-0000",
            kakao_url: "https://open.kakao.com/o/site",
            updated_at: "2026-10-24T01:00:00.000Z",
            ...(options.profile ?? {}),
          },
        ];
  return setFakeSupabase(
    new FakeSupabase({
      tables: {
        landing_pages: [
          queued("gunpo-sanbon-leak-detection", "군포시", "gunpo", "군포시 산본동", "누수탐지", "2026-10-23T12:38:38.000Z"),
          queued("gunpo-dang-pipe-cleaning", "군포시", "gunpo", "군포시 당동", "배관청소", "2026-10-23T12:38:38.000Z"),
          queued("bucheon-sang-leak-detection", "부천시", "bucheon", "부천시 상동", "누수탐지", "2026-10-23T12:38:38.000Z"),
          queued("hidden-noindex", "당진시", "dangjin", "당진시 읍내동", "정화조막힘", "2026-10-25T00:00:00.000Z"),
          pageRow("private-page", { status: "private", keyword: "누수탐지", region: "비공개동", updated_at: "2026-10-30T00:00:00.000Z" }),
          // 기존 페이지: 키워드·시/군이 없어 홈에는 나오지 않는다(나중에 수정돼도 홈 lastmod에 영향 없음)
          pageRow("legacy-page", { updated_at: "2026-10-29T00:00:00.000Z" }),
          ...(options.extra ?? []),
        ],
        landing_page_seo_settings: [{ landing_page_id: "hidden-noindex", seo_noindex: true }],
        site_profile: profileRow,
      },
      relations: {
        landing_pages: { landing_page_seo_settings: { kind: "one", localKey: "id", foreignKey: "landing_page_id" } },
      },
    })
  );
}

// ------------------------------------------------------------

describe("업체 칸 거르기(lib/business-info)", () => {
  it.each([
    ["경기 군포시 산본로 1", true],
    ["협력로 281 메가폴리스 b동", true],
    ["서울특별시 강서구 방화대로 12, 2층", true],
    ["siheung-eunhaeng-drain-unclogging", false],
    ["당진시 송악읍하수구뚫는곳", false], // 번지 없음
    ["소하동정화조막힘 / 광명정화조막힘 / 오수배관막힘", false],
    ["정왕동유리창청소 | 상가·공장·사무실 유리창 전문관리", false],
    ["수원시 세류동 하수구뚫음 안내. 베란다 배수구 3곳을 점검합니다.", false], // 문장
    ["", false],
  ])("주소처럼 보이는가: %j → %s", (address, expected) => {
    expect(looksLikePostalAddress(address)).toBe(expected);
  });

  it("업체명·제목과 같은 글이면 주소가 아니다", () => {
    expect(looksLikePostalAddress("군포시 산본동 1", ["군포시  산본동 1"])).toBe(false);
  });

  it("업체명이 이름으로 보이는가: 제목과 같음·30자 초과·구분 기호 이어 붙임이면 아니다", () => {
    expect(isDistinctBusinessName("원케어배관", "군포시 산본동 누수탐지")).toBe(true);
    expect(isDistinctBusinessName("평택 고덕동하수구뚫음", "평택 고덕동하수구뚫음")).toBe(false);
    expect(isDistinctBusinessName("구리 하수구 막힘·싱크대·변기 뚫음 전문 | 원케어배관", "다른 제목")).toBe(false);
    expect(isDistinctBusinessName("가".repeat(31), "다른 제목")).toBe(false);
    expect(isDistinctBusinessName("", "제목")).toBe(false);
  });

  it("조사 은/는, 해시태그·줄바꿈 제거, 서비스 지역 이름 중복 제거", () => {
    expect(withTopicParticle("원케어배관")).toBe("원케어배관은");
    expect(withTopicParticle("원케어 헬스")).toBe("원케어 헬스는");
    expect(withTopicParticle("OneCare")).toBe("OneCare은(는)");
    expect(toPlainSummary("배관을 확인합니다.\n\n#은행동 #시흥하수구 끝")).toBe("배관을 확인합니다. 끝");
    expect(areaName("군포시", "군포시 산본동")).toBe("군포시 산본동");
    expect(areaName("군포시", "산본동")).toBe("군포시 산본동");
    expect(areaName(null, "산본동")).toBe("산본동");
  });
});

describe("기존 페이지(제목형 업체명·주소)의 자동 SEO·FAQ·구조화 데이터", () => {
  it("meta description에서 해시태그·줄바꿈을 뺀다(화면 본문은 그대로)", () => {
    expect(buildSeoDescription(legacy())).toBe("배수가 느리면 배관 내부를 확인해야 합니다.");
  });

  it("업체 소개·위치 자동 FAQ를 만들지 않고 전화·카카오·상담 FAQ만", () => {
    expect(buildAutomaticFaqs(legacy()).map((f) => f.question)).toEqual([
      "전화 상담은 어떻게 하나요?",
      "카카오톡 상담이 가능한가요?",
      "온라인 상담 신청이 가능한가요?",
    ]);
  });

  it("주소가 실제 주소면 위치 FAQ를 만들고, 이름이 아니면 업체명 없이 묻는다", () => {
    const withAddress = { ...legacy(), address: "경기 시흥시 은행로 12" };
    expect(buildAutomaticFaqs(withAddress).map((f) => f.question)).toContain("위치는 어디인가요?");
    const named = page({ address: "경기 군포시 산본로 1" });
    expect(buildAutomaticFaqs(named).map((f) => f.question).slice(0, 2)).toEqual([
      "원케어배관은 어떤 곳인가요?",
      "원케어배관 위치는 어디인가요?",
    ]);
  });

  it("엉터리 주소는 PostalAddress로 내보내지 않고, 서비스 지역도 없으면 Organization", () => {
    const lp = legacy();
    const org = buildOrganizationJsonLd(lp, resolveLandingPageSeo(lp, null));
    expect(org["@type"]).toBe("Organization");
    expect(org).not.toHaveProperty("address");
    expect(org.telephone).toBe("010-2068-8782");
  });

  it("화면 FAQ와 FAQPage JSON-LD가 같은 순서·같은 글(기존 페이지·대기열 페이지 모두)", () => {
    for (const lp of [legacy(), page()]) {
      const manual = [
        { id: "f1", landing_page_id: lp.id, question: "누수 점검하면 바닥을 바로 뜯나요?", answer: "먼저 위치를 확인합니다.", sort_order: 1, is_active: true, created_at: "", updated_at: "" },
      ];
      const faqs = resolveLandingPageFaqs(lp, manual, false);
      const html = renderToStaticMarkup(
        <LandingPageRenderer landingPage={lp} faqs={faqs} resolvedSeo={resolveLandingPageSeo(lp, null)} />
      );
      const screen = Array.from((html.split("자주 묻는 질문")[1] ?? "").matchAll(/<h3[^>]*>(.*?)<\/h3>/g))
        .map((m) => m[1])
        .slice(0, faqs.length);
      const ld = jsonLdBlocks(html).find((b) => b["@type"] === "FAQPage") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
      expect(screen).toEqual(faqs.map((f) => f.question));
      expect(ld.mainEntity.map((q) => q.name)).toEqual(faqs.map((f) => f.question));
      expect(ld.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(faqs.map((f) => f.answer));
    }
  });
});

describe("랜딩 구조화 데이터: 대표 업체와 같은 업체로 묶기", () => {
  it("areaServed는 '군포시 산본동'(시/군 중복 없음), LocalBusiness", () => {
    const lp = page();
    const org = buildOrganizationJsonLd(lp, resolveLandingPageSeo(lp, null));
    expect(org["@type"]).toBe("LocalBusiness");
    expect(org.areaServed).toEqual({ "@type": "AdministrativeArea", name: "군포시 산본동" });
    expect(org).not.toHaveProperty("@id");
  });

  it("업체명이 대표 업체와 같으면 홈과 같은 @id·이름·주소·소개, 전화는 페이지 값이 없을 때 대표 업체 값", () => {
    const lp = page();
    const site = profile();
    const org = buildOrganizationJsonLd(lp, resolveLandingPageSeo(lp, null), site);
    expect(org).toMatchObject({
      "@type": "LocalBusiness",
      "@id": "https://example.test/#business",
      name: "원케어배관",
      url: "https://example.test/",
      description: site.description,
      telephone: site.phone,
    });
    const withPhone = page({ phone: "031-111-2222" });
    expect(buildOrganizationJsonLd(withPhone, resolveLandingPageSeo(withPhone, null), site).telephone).toBe("031-111-2222");
    const web = buildWebPageJsonLd(lp, resolveLandingPageSeo(lp, null), site);
    expect(web.about).toEqual({ "@id": "https://example.test/#business" });
    expect(web.isPartOf).toEqual({ "@id": "https://example.test/#website" });
  });

  it("다른 업체(업체명이 다르면)는 묶지 않는다", () => {
    const other = page({ business_name: "다른 유리창청소", phone: "010-8226-0126" });
    const org = buildOrganizationJsonLd(other, resolveLandingPageSeo(other, null), profile());
    expect(org).not.toHaveProperty("@id");
    expect(org.name).toBe("다른 유리창청소");
    expect(org.telephone).toBe("010-8226-0126");
  });
});

describe("공개 홈(/)", () => {
  it("대표 업체 소개 + 서비스별·지역별 링크 + WebSite·LocalBusiness JSON-LD, 관리자 링크 없음", async () => {
    siteDb();
    const html = renderToStaticMarkup(await HomePage());

    expect(Array.from(html.matchAll(/<h1[^>]*>(.*?)<\/h1>/g)).map((m) => m[1])).toEqual(["원케어배관"]);
    expect(html).toContain("누수탐지·배관청소·하수구 막힘을 점검합니다.");
    expect(html).toContain('href="tel:01000000000"');
    expect(html).toContain('href="https://open.kakao.com/o/site"');
    // 서비스(키워드)별: 페이지 수가 많은 순
    expect(Array.from(html.matchAll(/<h3[^>]*>([^<]*)/g)).map((m) => m[1].trim())).toEqual(["누수탐지", "배관청소"]);
    expect(html).toContain('href="/gunpo-sanbon-leak-detection"');
    expect(html).toContain('href="/bucheon-sang-leak-detection"');
    // 지역(시/군 모음)별: noindex만 있는 당진시는 없다
    expect(html).toContain('href="/area/gunpo"');
    expect(html).toContain('href="/area/bucheon"');
    expect(html).not.toContain("/area/dangjin");
    expect(html).not.toContain("hidden-noindex");
    expect(html).not.toContain("private-page");
    expect(html).not.toContain("legacy-page");
    expect(html).not.toContain("/admin");
    expect(html).not.toContain("/login");

    const blocks = jsonLdBlocks(html);
    expect(blocks.map((b) => b["@type"])).toEqual(["WebSite", "LocalBusiness"]);
    expect(blocks[0]).toMatchObject({
      "@id": "https://example.test/#website",
      url: "https://example.test/",
      name: "원케어배관",
      inLanguage: "ko-KR",
      publisher: { "@id": "https://example.test/#business" },
    });
    expect(blocks[1]).toMatchObject({
      "@id": "https://example.test/#business",
      name: "원케어배관",
      telephone: "010-0000-0000",
      areaServed: [
        { "@type": "AdministrativeArea", name: "군포시" },
        { "@type": "AdministrativeArea", name: "부천시" },
      ],
    });
    expect(blocks[1]).not.toHaveProperty("address");

    const meta = await homeMetadata();
    expect(meta.title).toBe("원케어배관 | 누수탐지, 배관청소 지역별 안내");
    expect(meta.description).toBe("누수탐지·배관청소·하수구 막힘을 점검합니다.");
    expect(meta.alternates?.canonical).toBe("https://example.test/");
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("홈의 업체 @id와 같은 이름의 랜딩페이지 업체 @id가 같다(페이지마다 같은 업체 정보)", async () => {
    siteDb();
    const homeLd = jsonLdBlocks(renderToStaticMarkup(await HomePage())).find((b) => b["@type"] === "LocalBusiness")!;
    const lp = page();
    const html = renderToStaticMarkup(
      <LandingPageRenderer landingPage={lp} faqs={[]} resolvedSeo={resolveLandingPageSeo(lp, null)} siteBusiness={profile()} />
    );
    const pageLd = jsonLdBlocks(html).find((b) => b["@type"] === "LocalBusiness")!;
    for (const key of ["@id", "name", "url", "telephone", "description"]) expect(pageLd[key]).toEqual(homeLd[key]);
  });

  it("대표 업체 설정이 비어 있으면 업체 소개·연락처·LocalBusiness 없이 서비스·지역 링크만", async () => {
    siteDb({ profile: { business_name: null, description: null, phone: null, kakao_url: null } });
    const html = renderToStaticMarkup(await HomePage());
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("카카오톡 상담");
    expect(html).toContain('href="/area/gunpo"');
    const blocks = jsonLdBlocks(html);
    expect(blocks.map((b) => b["@type"])).toEqual(["WebSite"]);
    expect(blocks[0].name).toBe("example.test");
    expect(blocks[0]).not.toHaveProperty("publisher");
    const meta = await homeMetadata();
    expect(meta.title).toBe("누수탐지, 배관청소 지역별 안내");
    expect(meta.description).toBe("군포시, 부천시 지역의 누수탐지, 배관청소 안내 페이지를 지역별로 모았습니다.");
  });

  it("017 적용 전(site_profile 행 없음)이어도 오류 없이 렌더링", async () => {
    siteDb({ profile: null });
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('href="/area/gunpo"');
  });

  it(`서비스마다 홈에는 최대 ${HOME_SERVICE_LINK_LIMIT}개, 나머지는 시/군 모음 링크로`, () => {
    const rows = Array.from({ length: HOME_SERVICE_LINK_LIMIT + 3 }, (_, i) => ({
      slug: `p${i}`,
      title: `t${i}`,
      updated_at: null,
      created_at: "2026-10-01T00:00:00.000Z",
      published_at: "2026-10-01T00:00:00.000Z",
      region: `군포시 동${String(i).padStart(2, "0")}`,
      keyword: "누수탐지",
      city: "군포시",
      city_slug: "gunpo",
    }));
    const content = buildHomeContent(rows, EMPTY_SITE_PROFILE);
    expect(content.services[0].pageCount).toBe(HOME_SERVICE_LINK_LIMIT + 3);
    expect(content.services[0].pages).toHaveLength(HOME_SERVICE_LINK_LIMIT);
    expect(content.services[0].cities).toEqual([{ href: "/area/gunpo", label: "군포시" }]);
  });
});

describe("sitemap.xml: 홈 + lastmod", () => {
  it("첫 항목이 홈(/)이고, lastmod는 홈에 보이는 내용·대표 업체 설정 중 최신", async () => {
    siteDb();
    const entries = await sitemap();
    expect(entries[0].url).toBe("https://example.test/");
    // 대기열 페이지 2026-10-23T12:38:38Z < 대표 업체 설정 2026-10-24T01:00Z. 기존 페이지(10-29)·noindex(10-25)·비공개(10-30)는 제외
    expect((entries[0].lastModified as Date).toISOString()).toBe("2026-10-24T01:00:00.000Z");
    expect(entries.filter((e) => e.url === "https://example.test/")).toHaveLength(1);
    expect(entries.map((e) => e.url)).toContain("https://example.test/area/gunpo");
  });

  it("대표 업체 설정이 비어 있으면 페이지 기준, 보이는 것이 없으면 lastmod 생략", async () => {
    siteDb({ profile: { business_name: null, description: null, phone: null, kakao_url: null } });
    expect(((await sitemap())[0].lastModified as Date).toISOString()).toBe("2026-10-23T12:38:38.000Z");

    setFakeSupabase(
      new FakeSupabase({
        tables: { landing_pages: [pageRow("legacy-only")], landing_page_seo_settings: [], site_profile: [] },
        relations: {
          landing_pages: { landing_page_seo_settings: { kind: "one", localKey: "id", foreignKey: "landing_page_id" } },
        },
      })
    );
    const [home] = await sitemap();
    expect(home.url).toBe("https://example.test/");
    expect(home).not.toHaveProperty("lastModified");
  });
});

describe("robots.txt", () => {
  it("/admin·/login·/api를 끝 슬래시 없이 차단, 홈·허브·llms.txt 허용, sitemap 주소", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules.disallow).toEqual(["/admin", "/login", "/api"]);
    expect(rules.allow).toEqual(["/", "/area/", "/llms.txt"]);
    expect(result.sitemap).toBe("https://example.test/sitemap.xml");
  });

  it("robots.txt 규칙(앞부분 일치)으로 주소 자체와 하위 경로가 모두 막히고, 공개 주소는 막히지 않는다", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    const disallow = ([] as string[]).concat(rules.disallow ?? []);
    const blocked = (path: string) => disallow.some((prefix) => path.startsWith(prefix));
    for (const path of ["/admin", "/admin/", "/admin/settings", "/login", "/login?next=/admin", "/api", "/api/", "/api/indexnow"]) {
      expect(blocked(path), path).toBe(true);
    }
    for (const path of ["/", "/area/gunpo", "/llms.txt", "/sitemap.xml", "/gunpo-sanbon-leak-detection"]) {
      expect(blocked(path), path).toBe(false);
    }
  });
});

describe("/llms.txt", () => {
  it("업체 한 줄 소개·서비스·시/군 허브·문의 방법·주요 주소 — DB 값만", async () => {
    siteDb();
    const response = await llmsTxt();
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await response.text();
    expect(text.startsWith("# 원케어배관\n\n> 누수탐지·배관청소·하수구 막힘을 점검합니다.\n")).toBe(true);
    expect(text).toContain("## 서비스\n- 누수탐지: 안내 페이지 2곳 — 군포시, 부천시");
    expect(text).toContain("  - [군포시 산본동 누수탐지](https://example.test/gunpo-sanbon-leak-detection)");
    expect(text).toContain("## 지역별 안내(시/군)\n- [군포시](https://example.test/area/gunpo): 누수탐지, 배관청소 · 2곳");
    expect(text).toContain("- 전화: 010-0000-0000");
    expect(text).toContain("- [카카오톡 상담](https://open.kakao.com/o/site)");
    expect(text).toContain("- [사이트맵](https://example.test/sitemap.xml)");
    expect(text).not.toContain("hidden-noindex");
    expect(text).not.toContain("private-page");
    expect(text).not.toContain("legacy-page");
  });

  it("대표 업체 설정이 비어 있으면 도메인 이름, 전화·카카오 줄 없음(지어내지 않음)", async () => {
    siteDb({ profile: { business_name: null, description: null, phone: null, kakao_url: null } });
    const text = await (await llmsTxt()).text();
    expect(text.startsWith("# example.test\n")).toBe(true);
    expect(text).not.toContain("전화:");
    expect(text).not.toContain("카카오톡");
    expect(text).toContain("- 각 안내 페이지 하단의 상담 신청 양식");
  });

  it("DB 값의 줄바꿈·대괄호가 마크다운 목록을 깨뜨리지 않는다", async () => {
    siteDb({ profile: { business_name: "원케어\n[배관]", description: "한 줄\n두 줄" } });
    const text = await (await llmsTxt()).text();
    expect(text.startsWith("# 원케어 배관\n\n> 한 줄 두 줄\n")).toBe(true);
  });
});

describe("대표 업체 입력 검사", () => {
  it("앞뒤 공백 제거, 빈 값은 null, 소개의 줄바꿈은 한 칸", () => {
    expect(sanitizeSiteProfileInput({ businessName: " 원케어배관 ", description: "한 줄\n소개", phone: "", kakaoUrl: " " })).toEqual({
      ok: true,
      value: { businessName: "원케어배관", description: "한 줄 소개", phone: null, kakaoUrl: null },
    });
  });

  it.each([
    [{ businessName: "가".repeat(101) }, "업체명은(는) 100자 이내"],
    [{ phone: "전화 주세요" }, "전화번호는 숫자"],
    [{ kakaoUrl: "javascript:alert(1)" }, "카카오톡 URL은 http"],
    [{ businessName: "<script>" }, "줄바꿈이나 < > 기호"],
  ])("거부: %j", (patch, message) => {
    const result = sanitizeSiteProfileInput({ businessName: "", description: "", phone: "", kakaoUrl: "", ...patch });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain(message);
  });
});

describe("AEO: 대량 생성 FAQ 질문 규칙", () => {
  it("물음표로 끝나지 않는 FAQ 질문은 경고(저장은 막지 않음)", () => {
    const warnings = collectFaqQuestionWarnings({
      faqQuestion1: "아랫집 천장에 물자국이 생겼는데 우리 집 문제인가요?",
      faqQuestion2: "관리사무소에 설명할 자료가 필요해요",
      faqQuestion3: "",
    });
    expect(warnings).toEqual([
      {
        code: "faq_not_question",
        fields: ["faqQuestion2"],
        message: "FAQ 질문2이(가) 물음표(?)로 끝나지 않습니다. 손님이 실제로 묻는 말투의 질문 문장으로 써 주세요.",
      },
    ]);
    expect(collectFaqQuestionWarnings({ faqQuestion1: "주차 되나요？" })).toEqual([]);
  });

  it("프롬프트에 '손님 말투의 실제 질문' 규칙이 들어 있다", () => {
    const {
      prompts: [prompt],
    } = buildBulkPrompts({
      regions: [{ name: "산본동", slug: "sanbon" }],
      keywords: [{ name: "누수탐지", slug: "leak-detection" }],
      business: { businessName: "원케어배관", phone: "", kakaoUrl: "", address: "", template: "template-a", industry: "" },
    });
    expect(prompt.text).toContain("손님이 전화나 카카오톡으로 실제로 물어볼 말투의 질문 한 문장");
    expect(prompt.text).toContain("물음표(?)로 끝내세요");
    expect(prompt.text).toContain("8. 위의 글자 수 제한을 반드시 지키세요.");
  });
});

// LandingPageRenderer가 홈 테스트 밖에서도 대표 업체 없이 기존처럼 동작하는지(회귀)
describe("대표 업체 없이 렌더링(미리보기 등)", () => {
  it("siteBusiness를 넘기지 않으면 페이지 값만 쓴다", () => {
    const lp = page();
    const html = renderToStaticMarkup(<LandingPageRenderer landingPage={lp} faqs={[]} resolvedSeo={resolveLandingPageSeo(lp, null)} />);
    const org = jsonLdBlocks(html).find((b) => b["@type"] === "LocalBusiness")!;
    expect(org).not.toHaveProperty("@id");
    expect(org.url).toBe("https://example.test/gunpo-sanbon-leak-detection");
  });
});

describe("slug: admin·login·api로 시작하는 주소 금지(robots.txt 차단과 같은 규칙)", () => {
  const MSG = "admin, login, api로 시작하는 URL은 사용할 수 없습니다(검색엔진 차단 주소와 겹침).";

  it("공용 판별(isReservedSlug): 예약어·앞부분 차단, 가운데·끝은 허용", async () => {
    const { isReservedSlug, hasBlockedSlugPrefix, BLOCKED_SLUG_PREFIXES } = await import("@/lib/slug");
    expect(BLOCKED_SLUG_PREFIXES).toEqual(["admin", "login", "api"]);
    for (const slug of ["admin", "admin-xxx", "apink-xxx", "api2", "login-help", " ADMIN-GYM "]) {
      expect(hasBlockedSlugPrefix(slug), slug).toBe(true);
      expect(isReservedSlug(slug), slug).toBe(true);
    }
    for (const slug of ["my-admin", "rapid-api", "apartment", "a-login", "area-gym"]) {
      expect(isReservedSlug(slug), slug).toBe(false);
    }
  });

  it("robots.txt Disallow가 같은 목록에서 만들어진다", async () => {
    const { BLOCKED_SLUG_PREFIXES } = await import("@/lib/slug");
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules.disallow).toEqual(BLOCKED_SLUG_PREFIXES.map((p) => `/${p}`));
  });

  it("대량 등록(엑셀·붙여넣기·대기열 수정 공용 검사): 자동 slug와 직접 입력 slug 모두 막는다", async () => {
    const { checkBulkUploadRows } = await import("@/lib/bulk-upload/check");
    const base = {
      region: "압구정동",
      keyword: "누수탐지",
      keywordSlug: "leak-detection",
      businessName: "원케어배관",
      title: "압구정동 누수탐지",
      heroText: "문구",
      description: "설명입니다.",
      mainImageUrl: "https://img.example/a.jpg",
    };
    const result = checkBulkUploadRows(
      [
        { rowNumber: 2, values: { ...base, regionSlug: "apgujeong" }, warnings: [] },
        { rowNumber: 3, values: { ...base, region: "아피동", regionSlug: "apink" }, warnings: [] },
        { rowNumber: 4, values: { ...base, region: "직접동", regionSlug: "jikjeop", slug: "admin-page" }, warnings: [] },
      ],
      { existingSlugs: [], existingPairs: [], corpus: [], thresholds: { warning: 0.6, error: 0.8 } }
    );
    const errorsOf = (i: number) => result.rows[i].errors.filter((e) => e.code === "reserved_slug").map((e) => e.message);
    expect(errorsOf(0)).toEqual([]);
    expect(errorsOf(1)).toEqual([MSG]);
    expect(errorsOf(2)).toEqual([MSG]);
    expect(result.rows[1].status).toBe("error");
  });

  it("프롬프트 만들기: 만들어질 URL이 차단 글자로 시작하는 지역이 있으면 프롬프트를 만들지 않는다", () => {
    const business = { businessName: "원케어배관", phone: "", kakaoUrl: "", address: "", template: "template-a", industry: "" };
    const blocked = buildBulkPrompts({
      regions: [
        { name: "압구정동", slug: "apgujeong" },
        { name: "아피동", slug: "apink" },
        { name: "로그동", slug: "login-dong" },
      ],
      keywords: [{ name: "누수탐지", slug: "leak-detection" }, { name: "배관청소", slug: "pipe-cleaning" }],
      business,
    });
    expect(blocked.prompts).toEqual([]);
    expect(blocked.errors).toEqual([`아피동(apink), 로그동(login-dong): ${MSG} 지역 slug를 바꿔주세요.`]);

    const ok = buildBulkPrompts({
      regions: [{ name: "압구정동", slug: "apgujeong" }],
      keywords: [{ name: "관리자", slug: "admin" }], // 키워드 slug는 뒤에 붙으므로 괜찮다(apgujeong-admin)
      business,
    });
    expect(ok.errors).toEqual([]);
    expect(ok.prompts).toHaveLength(1);
  });
});
