import "server-only";

import { cache } from "react";
import { getPublicLandingPagesForSitemap } from "@/lib/landing-pages";
import { getSiteProfile } from "@/lib/site-profile";
import { buildHomeContent, type HomeContent } from "@/lib/site-home";

/**
 * 공개 홈(/)·/llms.txt·sitemap(홈 lastmod)이 쓰는 데이터. 같은 요청 안에서
 * generateMetadata와 페이지 본문이 함께 불러도 DB 조회는 한 번만 한다.
 * 조회에 실패하면 빈 목록으로 만든다(공개 페이지가 오류로 죽지 않게).
 */
export const loadHomeContent = cache(async (): Promise<HomeContent> => {
  const [{ data: rows }, profile] = await Promise.all([getPublicLandingPagesForSitemap(), getSiteProfile()]);
  return buildHomeContent(rows, profile);
});
