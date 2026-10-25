import type { MetadataRoute } from "next";
import { getAbsoluteUrl } from "@/lib/site";

/**
 * 관리자/인증/API 경로만 명시적으로 차단한다. private 랜딩페이지는 이미
 * 404이므로(기존 status + 404 로직) 여기 개별 slug를 나열하지 않는다 —
 * robots.txt는 접근 보안 도구가 아니다.
 *
 * "/admin"은 끝 슬래시 없이 적어 /admin 자체와 /admin/... 를 함께 막는다
 * (robots.txt 규칙은 앞부분 일치). 공개 홈(/)·지역 모음(/area/)·/llms.txt는 허용.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/area/", "/llms.txt"],
      disallow: ["/admin", "/login", "/api/"],
    },
    sitemap: getAbsoluteUrl("/sitemap.xml"),
  };
}
