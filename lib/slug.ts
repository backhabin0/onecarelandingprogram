/**
 * app/[slug]/page.tsx는 이 목록에 없는 모든 경로를 랜딩페이지 slug로 취급한다.
 * 아래 값들은 실제 이 프로젝트에 존재하는 시스템 경로(admin/login/api 및
 * app 루트의 sitemap.xml/robots.txt/favicon.ico)와, 아직 없지만 흔히 쓰이는
 * 예약 경로(manifest.webmanifest, Next.js 내부 자산 경로 _next)다. 실제로
 * 충돌하지 않는 값을 무작정 늘리지 않는다.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "admin",
  "login",
  "api",
  "sitemap.xml",
  "robots.txt",
  "favicon.ico",
  "manifest.webmanifest",
  "_next",
  // 7단계: 지역 모음 페이지(/area/{city_slug})
  "area",
];

/**
 * 이 글자로 시작하는 slug는 만들 수 없다. robots.txt가 /admin·/login·/api를 끝 슬래시 없이
 * 막아서(앞부분 일치) "/admin-gym", "/apink-…" 같은 주소도 검색엔진에서 차단되기 때문이다.
 * app/robots.ts도 이 목록으로 Disallow를 만든다(두 규칙이 어긋나지 않게).
 */
export const BLOCKED_SLUG_PREFIXES: readonly string[] = ["admin", "login", "api"];

export function hasBlockedSlugPrefix(slug: string): boolean {
  const value = slug.trim().toLowerCase();
  return BLOCKED_SLUG_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export const BLOCKED_SLUG_PREFIX_MESSAGE = `${BLOCKED_SLUG_PREFIXES.join(", ")}로 시작하는 URL은 사용할 수 없습니다(검색엔진 차단 주소와 겹침).`;

/** 예약어와 같거나 차단된 글자로 시작하면 true(복구·검사 공용) */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug.toLowerCase()) || hasBlockedSlugPrefix(slug);
}
