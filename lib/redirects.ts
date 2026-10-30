import "server-only";

import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { buildRedirectMap } from "@/lib/redirect-map";

/**
 * 301 이동 목록(migration 020) 조회 — 공개 목록에서 옛 주소를 빼고, 관리자 화면에서 목록을 보여 준다.
 * 실제 이동은 proxy(lib/supabase/redirect-proxy.ts)가 한다.
 */

interface RedirectTableRow {
  from_slug: string;
  to_slug: string;
  note: string;
  created_at: string;
}

async function selectRedirectRows(): Promise<{ data: RedirectTableRow[]; error: string | null }> {
  const supabase = await getSupabaseServerClient();
  return fetchAllRows<RedirectTableRow>((from, to) =>
    supabase
      .from("landing_page_redirects")
      .select("from_slug, to_slug, note, created_at")
      .order("from_slug", { ascending: true })
      .range(from, to)
  );
}

/**
 * 다른 주소로 이동된 옛 slug 모음. sitemap·홈·llms.txt·허브·내부 링크에서 뺀다.
 * 못 읽으면(020 적용 전 등) 빈 모음 — 목록은 예전처럼 나온다(공개 화면이 오류로 죽지 않게).
 * 같은 요청 안에서는 한 번만 읽는다.
 */
export const getRedirectedSlugs = cache(async (): Promise<ReadonlySet<string>> => {
  try {
    const { data, error } = await selectRedirectRows();
    if (error) {
      console.error("[redirects] select error:", error);
      return new Set();
    }
    return new Set(buildRedirectMap(data).keys());
  } catch (err) {
    console.error("[redirects] client error:", err instanceof Error ? err.message : err);
    return new Set();
  }
});

export type RedirectPageState = "public" | "private" | "missing";

export interface AdminRedirectItem {
  fromSlug: string;
  toSlug: string;
  note: string;
  createdAt: string;
  /** 옛 주소의 페이지 상태(이동이 먼저 적용되므로 공개여도 방문자에게는 보이지 않음) */
  fromState: RedirectPageState;
  toState: RedirectPageState;
  toNoindex: boolean;
  /** 이동이 제대로 되지 않는 이유(없으면 null) */
  problem: string | null;
}

const IN_CHUNK = 100;

/** 관리자 화면: 이동 목록 전체 + 양쪽 페이지 상태 */
export async function listRedirectsForAdmin(): Promise<{ data: AdminRedirectItem[]; error: string | null }> {
  const failed = { data: [], error: "이동 목록을 불러오지 못했습니다. migration 020이 적용되었는지 확인해 주세요." };
  try {
    const { data: rows, error } = await selectRedirectRows();
    if (error) {
      console.error("[redirects] admin select error:", error);
      return failed;
    }

    const slugs = Array.from(new Set(rows.flatMap((row) => [row.from_slug, row.to_slug])));
    const pages = new Map<string, { status: string; noindex: boolean }>();
    const supabase = await getSupabaseServerClient();
    for (let i = 0; i < slugs.length; i += IN_CHUNK) {
      const { data, error: pageError } = await supabase
        .from("landing_pages")
        .select("slug, status, seo:landing_page_seo_settings(seo_noindex)")
        .in("slug", slugs.slice(i, i + IN_CHUNK));
      if (pageError) {
        console.error("[redirects] page select error:", pageError.message);
        return failed;
      }
      for (const page of (data ?? []) as unknown as { slug: string; status: string; seo: { seo_noindex: boolean } | null }[]) {
        pages.set(page.slug, { status: page.status, noindex: page.seo?.seo_noindex === true });
      }
    }

    const stateOf = (slug: string): RedirectPageState => {
      const page = pages.get(slug);
      if (!page) return "missing";
      return page.status === "public" ? "public" : "private";
    };
    const redirected = new Set(rows.map((row) => row.from_slug));

    return {
      data: rows.map((row) => {
        const toState = stateOf(row.to_slug);
        const toNoindex = pages.get(row.to_slug)?.noindex ?? false;
        let problem: string | null = null;
        if (redirected.has(row.to_slug)) problem = "새 주소가 다시 이동됨(연쇄) — 이동하지 않음";
        else if (toState === "missing") problem = "새 주소에 페이지가 없음(주소가 바뀌었거나 삭제됨)";
        else if (toState === "private") problem = "새 주소 페이지가 비공개";
        else if (toNoindex) problem = "새 주소 페이지가 검색 제외(noindex)";
        return {
          fromSlug: row.from_slug,
          toSlug: row.to_slug,
          note: row.note,
          createdAt: row.created_at,
          fromState: stateOf(row.from_slug),
          toState,
          toNoindex,
          problem,
        };
      }),
      error: null,
    };
  } catch (err) {
    console.error("[redirects] client error:", err instanceof Error ? err.message : err);
    return failed;
  }
}
