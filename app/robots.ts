import type { MetadataRoute } from "next";
import { getAbsoluteUrl } from "@/lib/site";

/**
 * 관리자/인증/API 경로만 명시적으로 차단한다. private 랜딩페이지는 이미
 * 404이므로(기존 status + 404 로직) 여기 개별 slug를 나열하지 않는다 —
 * robots.txt는 접근 보안 도구가 아니다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/login", "/api/"],
    },
    sitemap: getAbsoluteUrl("/sitemap.xml"),
  };
}
