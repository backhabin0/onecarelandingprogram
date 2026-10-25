import type { MetadataRoute } from "next";
import { getPublicLandingPagesForSitemap } from "@/lib/landing-pages";
import { getAbsoluteUrl } from "@/lib/site";
import { getSitemapLastModified } from "@/lib/sitemap-lastmod";
import { areaHubPath, buildAreaHubs } from "@/lib/local-seo";
import { buildHomeContent } from "@/lib/site-home";
import { getSiteProfile } from "@/lib/site-profile";

/**
 * status = 'public'이면서 seo_noindex가 true가 아닌 landing_pages만 포함한다
 * (12.5단계). private/삭제된 페이지, noindex 페이지, 관리자 라우트(/admin,
 * /login, /api/*)는 절대 포함하지 않는다.
 *
 * 관리자가 상태를 바꾸거나 페이지를 생성/삭제/slug 변경하면 다음 크롤링 시
 * 곧바로 반영된다 — 조회 함수가 요청 쿠키 기반 Supabase 클라이언트를 쓰기
 * 때문에 이 라우트는 Next.js에 의해 항상 동적으로 렌더링되고, 별도의 캐시
 * revalidate 설정 없이도 DB 최신 상태를 그대로 반영한다.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: landingPages } = await getPublicLandingPagesForSitemap();

  const pages: MetadataRoute.Sitemap = landingPages.map((page) => ({
    url: getAbsoluteUrl(`/${page.slug}`),
    lastModified: getSitemapLastModified(page),
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // 7단계: 지역 모음 페이지(/area/{city_slug}) — 공개+noindex 아닌 페이지가 1개 이상인 시/군만.
  // landingPages는 이미 noindex를 뺀 목록이라 그대로 묶는다(추가 조회 없음).
  const hubs: MetadataRoute.Sitemap = buildAreaHubs(
    landingPages.map((page) => ({ ...page, noindex: false }))
  ).map((hub) => ({
    url: getAbsoluteUrl(areaHubPath(hub.citySlug)),
    lastModified: hub.lastModified,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  // 공개 홈(/): lastmod는 홈에 실제로 보이는 내용(서비스·지역 링크, 대표 업체 설정)의 최근 변경 시각.
  // 보이는 것이 하나도 없으면 lastmod를 생략한다(지어낸 날짜를 넣지 않음).
  const home = buildHomeContent(landingPages, await getSiteProfile());
  const homeEntry: MetadataRoute.Sitemap[number] = {
    url: getAbsoluteUrl("/"),
    ...(home.lastModified ? { lastModified: home.lastModified } : {}),
    changeFrequency: "daily",
    priority: 1,
  };

  return [homeEntry, ...pages, ...hubs];
}
