import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { buildRedirectMap, findRedirectPath, slugFromPathname, type RedirectRow } from "@/lib/redirect-map";

/**
 * 옛 랜딩페이지 주소 → 새 주소 301 이동(migration 020).
 *
 * 랜딩페이지 요청마다 DB를 읽지 않도록 목록 전체를 잠깐(60초) 기억한다. 같은 인스턴스가
 * 다시 쓰일 때만 효과가 있고(Fluid compute), 새 인스턴스는 처음 한 번 다시 읽는다.
 * 목록을 못 읽으면(020 적용 전·네트워크 오류) 이동하지 않고 예전처럼 페이지를 보여 준다.
 */

export const REDIRECT_CACHE_TTL_MS = 60_000;
const REDIRECT_RETRY_MS = 10_000;

let cached: { map: Map<string, string>; expiresAt: number } | null = null;

export function resetRedirectCacheForTest() {
  cached = null;
}

async function loadRedirectRows(): Promise<RedirectRow[] | null> {
  const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await fetchAllRows<RedirectRow>((from, to) =>
    supabase.from("landing_page_redirects").select("from_slug, to_slug").order("from_slug").range(from, to)
  );
  if (error) {
    console.error("[redirects] select error:", error);
    return null;
  }
  return data;
}

export async function getRedirectMap(now = Date.now()): Promise<Map<string, string>> {
  if (cached && cached.expiresAt > now) return cached.map;
  let rows: RedirectRow[] | null = null;
  try {
    rows = await loadRedirectRows();
  } catch (err) {
    console.error("[redirects] load error:", err instanceof Error ? err.message : err);
  }
  if (rows) {
    cached = { map: buildRedirectMap(rows), expiresAt: now + REDIRECT_CACHE_TTL_MS };
  } else {
    // 실패하면 이전 목록을 잠깐 더 쓰고(없으면 빈 목록) 조금 뒤에 다시 읽는다.
    cached = { map: cached?.map ?? new Map(), expiresAt: now + REDIRECT_RETRY_MS };
  }
  return cached.map;
}

/** 이동할 옛 주소면 301 응답, 아니면 null(쿼리 문자열은 그대로 붙인다) */
export async function redirectLandingPage(request: NextRequest): Promise<NextResponse | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!slugFromPathname(request.nextUrl.pathname)) return null;
  const target = findRedirectPath(await getRedirectMap(), request.nextUrl.pathname);
  if (!target) return null;
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.redirect(url, 301);
}
