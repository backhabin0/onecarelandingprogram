import type { MetadataRoute } from "next";
import { getPublicLandingPagesForSitemap } from "@/lib/landing-pages";
import { getAbsoluteUrl } from "@/lib/site";

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

  return landingPages.map((page) => ({
    url: getAbsoluteUrl(`/${page.slug}`),
    lastModified: new Date(page.updated_at || page.created_at),
    changeFrequency: "weekly",
    priority: 0.7,
  }));
}
