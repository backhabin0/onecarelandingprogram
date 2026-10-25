import type { SiteProfile } from "@/lib/site-profile";
import { areaHubPath, buildAreaHubs, regionKeywordPhrase } from "@/lib/local-seo";
import { getSitemapLastModified } from "@/lib/sitemap-lastmod";
import { toPlainSummary } from "@/lib/business-info";

/**
 * 공개 홈(/)과 /llms.txt의 내용(순수 함수). 둘 다 sitemap과 같은 목록
 * (공개 + noindex 아닌 페이지, getPublicLandingPagesForSitemap)과 대표 업체 설정만 쓴다.
 *
 * - 서비스: 키워드가 있는 페이지(대기열에서 공개된 페이지)를 키워드별로 묶는다.
 * - 지역: 지역 모음 페이지가 있는 시/군(buildAreaHubs — sitemap과 같은 기준).
 * - 키워드·시/군이 없는 기존 페이지는 홈에 나열하지 않는다(sitemap으로 수집된다).
 */

export interface HomePageRow {
  slug: string;
  title: string;
  updated_at: string | null;
  created_at: string;
  published_at: string | null;
  region: string | null;
  keyword: string | null;
  city: string | null;
  city_slug: string | null;
}

/** 서비스마다 홈에 바로 보여 주는 페이지 링크 수(나머지는 시/군 모음 페이지에서) */
export const HOME_SERVICE_LINK_LIMIT = 12;

export interface HomeLink {
  href: string;
  label: string;
}

export interface HomeService {
  keyword: string;
  pageCount: number;
  pages: HomeLink[];
  /** 이 서비스 페이지가 있는 시/군 모음 페이지 */
  cities: HomeLink[];
}

export interface HomeHub {
  city: string;
  href: string;
  pageCount: number;
  keywords: string[];
}

export interface HomeContent {
  businessName: string | null;
  summary: string;
  phone: string | null;
  kakaoUrl: string | null;
  services: HomeService[];
  hubs: HomeHub[];
  /** 홈에 보이는 내용(나열된 페이지·모음 페이지·대표 업체 설정) 중 가장 최근 변경 시각 */
  lastModified: Date | null;
}

const clean = (value: string | null | undefined) => (value ?? "").trim();
const ko = (a: string, b: string) => a.localeCompare(b, "ko");

/** "a, b, c 등" (최대 n개) */
export function listText(items: readonly string[], max = 5): string {
  return items.slice(0, max).join(", ") + (items.length > max ? " 등" : "");
}

export function buildHomeContent(rows: readonly HomePageRow[], profile: SiteProfile): HomeContent {
  const hubs = buildAreaHubs(rows.map((row) => ({ ...row, noindex: false })));
  const hubBySlug = new Map(hubs.map((hub) => [hub.citySlug, hub]));

  const byKeyword = new Map<string, HomePageRow[]>();
  for (const row of rows) {
    const keyword = clean(row.keyword);
    if (!keyword) continue;
    byKeyword.set(keyword, [...(byKeyword.get(keyword) ?? []), row]);
  }

  const services: HomeService[] = Array.from(byKeyword.entries())
    .map(([keyword, list]) => {
      const sorted = [...list].sort(
        (a, b) => ko(clean(a.region), clean(b.region)) || a.slug.localeCompare(b.slug)
      );
      const citySlugs = Array.from(new Set(sorted.map((row) => clean(row.city_slug)).filter((slug) => hubBySlug.has(slug))));
      return {
        keyword,
        pageCount: list.length,
        pages: sorted.slice(0, HOME_SERVICE_LINK_LIMIT).map((row) => ({
          href: `/${row.slug}`,
          label: regionKeywordPhrase(row) || row.title,
        })),
        cities: citySlugs
          .map((slug) => ({ href: areaHubPath(slug), label: hubBySlug.get(slug)!.city }))
          .sort((a, b) => ko(a.label, b.label)),
      };
    })
    .sort((a, b) => b.pageCount - a.pageCount || ko(a.keyword, b.keyword));

  const homeHubs: HomeHub[] = hubs
    .map((hub) => ({
      city: hub.city,
      href: areaHubPath(hub.citySlug),
      pageCount: hub.pageCount,
      keywords: hub.groups.map((g) => g.keyword),
    }))
    .sort((a, b) => ko(a.city, b.city));

  // lastmod: 홈에 실제로 보이는 것만 따진다(키워드·시/군이 없는 기존 페이지가 바뀌어도 홈은 그대로).
  const times = [
    ...rows
      .filter((row) => clean(row.keyword) || hubBySlug.has(clean(row.city_slug)))
      .map((row) => getSitemapLastModified(row).getTime()),
    profile.updatedAt && (profile.businessName || profile.description || profile.phone || profile.kakaoUrl)
      ? Date.parse(profile.updatedAt)
      : Number.NaN,
  ].filter(Number.isFinite);

  return {
    businessName: profile.businessName,
    summary: buildSummary(profile, services, homeHubs),
    phone: profile.phone,
    kakaoUrl: profile.kakaoUrl,
    services,
    hubs: homeHubs,
    lastModified: times.length > 0 ? new Date(Math.max(...times)) : null,
  };
}

/** 한 줄 소개: 대표 업체 소개 → 공개된 서비스·지역으로 만든 안내 → 기본 문구 */
function buildSummary(profile: SiteProfile, services: HomeService[], hubs: HomeHub[]): string {
  const manual = toPlainSummary(profile.description);
  if (manual) return manual;
  const keywords = services.map((s) => s.keyword);
  const cities = hubs.map((h) => h.city);
  if (keywords.length > 0 && cities.length > 0) {
    return `${listText(cities)} 지역의 ${listText(keywords)} 안내 페이지를 지역별로 모았습니다.`;
  }
  if (keywords.length > 0) return `${listText(keywords)} 안내 페이지를 모았습니다.`;
  return "지역별 서비스 안내 페이지입니다.";
}

/** 홈 <title>: "업체명 | 서비스 지역별 안내" (값이 없는 부분은 뺀다) */
export function buildHomeTitle(content: Pick<HomeContent, "businessName" | "services">): string {
  const keywords = content.services.map((s) => s.keyword);
  const guide = keywords.length > 0 ? `${listText(keywords, 3)} 지역별 안내` : "지역별 서비스 안내";
  return content.businessName ? `${content.businessName} | ${guide}` : guide;
}
