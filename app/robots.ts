import type { MetadataRoute } from "next";
import { getAbsoluteUrl } from "@/lib/site";
import { BLOCKED_SLUG_PREFIXES } from "@/lib/slug";

/**
 * 관리자/인증/API 경로만 명시적으로 차단한다. private 랜딩페이지는 이미
 * 404이므로(기존 status + 404 로직) 여기 개별 slug를 나열하지 않는다 —
 * robots.txt는 접근 보안 도구가 아니다.
 *
 * 끝 슬래시 없이 적어 /admin·/login·/api 주소 자체와 그 아래(/admin/...)를 함께 막는다
 * (robots.txt 규칙은 앞부분 일치). 그래서 이 글자로 시작하는 랜딩 slug는 만들 수 없게
 * lib/slug.ts의 같은 목록(BLOCKED_SLUG_PREFIXES)으로 검사한다.
 * 공개 홈(/)·지역 모음(/area/)·/llms.txt는 허용.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/area/", "/llms.txt"],
      disallow: BLOCKED_SLUG_PREFIXES.map((prefix) => `/${prefix}`),
    },
    sitemap: getAbsoluteUrl("/sitemap.xml"),
  };
}
