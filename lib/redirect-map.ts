/**
 * 랜딩페이지 301 이동(migration 020 landing_page_redirects) 공용 함수.
 * proxy·공개 목록·관리자 화면이 같이 쓴다. DB·Next.js에 의존하지 않는다(테스트하기 쉽게).
 */
import { isReservedSlug } from "@/lib/slug";

export interface RedirectRow {
  from_slug: string;
  to_slug: string;
}

/** 옛 slug → 새 slug. 혹시 DB 밖에서 연쇄·순환이 들어와도 한 번만 이동하고, 순환·자기 자신은 버린다 */
export function buildRedirectMap(rows: readonly RedirectRow[]): Map<string, string> {
  const raw = new Map<string, string>();
  for (const row of rows) {
    const from = row.from_slug?.trim().toLowerCase();
    const to = row.to_slug?.trim().toLowerCase();
    if (from && to && from !== to) raw.set(from, to);
  }
  const map = new Map<string, string>();
  for (const [from, to] of raw) {
    // 새 주소가 다시 옛 주소인 항목(연쇄)은 따라가지 않는다 — 이동이 여러 번 일어나지 않게 버린다.
    if (!raw.has(to)) map.set(from, to);
  }
  return map;
}

/** proxy에서 이동을 확인할 경로인지: "/한단어"이고 slug 모양일 때만(시스템 경로·예약 주소·파일은 건너뜀) */
export function slugFromPathname(pathname: string): string | null {
  const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(pathname);
  if (!match || isReservedSlug(match[1])) return null;
  return match[1];
}

/** 이동할 경로("/새slug") 또는 null */
export function findRedirectPath(map: ReadonlyMap<string, string>, pathname: string): string | null {
  const slug = slugFromPathname(pathname);
  if (!slug) return null;
  const to = map.get(slug);
  return to ? `/${to}` : null;
}
