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
];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug.toLowerCase());
}
