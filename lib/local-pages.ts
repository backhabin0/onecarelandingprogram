import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { getAbsoluteUrl } from "@/lib/site";
import { kstDayRange } from "@/lib/kst-date";
import { getRedirectedSlugs } from "@/lib/redirects";
import {
  buildAreaHubs,
  selectRelatedLinks,
  type AreaHub,
  type HubPageEntry,
  type LocalPageInfo,
  type RelatedCandidate,
  type RelatedLinks,
} from "@/lib/local-seo";

/**
 * 지역 SEO용 조회(7단계): 내부 링크 후보, 지역 모음 페이지, 날짜별 공개 주소.
 * 모두 status = 'public'인 페이지만 읽는다(anon도 읽을 수 있는 범위 — 공개 페이지 RLS).
 */

interface CandidateRow {
  slug: string;
  title: string;
  business_name: string;
  region: string | null;
  keyword: string | null;
  city: string | null;
  city_slug: string | null;
  seo: { seo_noindex: boolean } | null;
}

const CANDIDATE_SELECT = "slug, title, business_name, region, keyword, city, city_slug, seo:landing_page_seo_settings(seo_noindex)";

// 020: 다른 주소로 이동된 옛 페이지는 noindex처럼 링크에서 뺀다
const toCandidate = (row: CandidateRow, redirected: ReadonlySet<string>): RelatedCandidate => ({
  slug: row.slug,
  title: row.title,
  business_name: row.business_name,
  region: row.region,
  keyword: row.keyword,
  city: row.city,
  city_slug: row.city_slug,
  noindex: row.seo?.seo_noindex === true || redirected.has(row.slug),
});

const EMPTY_LINKS: RelatedLinks = { sameRegion: [], nearby: [], hub: null };

/** 공개 페이지 하단의 내부 링크. 지역·키워드가 없는 페이지(직접 만든 페이지)는 빈 값 */
export async function getRelatedLinks(page: LocalPageInfo): Promise<RelatedLinks> {
  const region = page.region?.trim();
  const keyword = page.keyword?.trim();
  const citySlug = page.city_slug?.trim();
  if (!region || !keyword) return citySlug && page.city ? selectRelatedLinks(page, []) : EMPTY_LINKS;

  try {
    const supabase = await getSupabaseServerClient();

    let sameRegionQuery = supabase
      .from("landing_pages")
      .select(CANDIDATE_SELECT)
      .eq("status", "public")
      .eq("region", region);
    sameRegionQuery = citySlug ? sameRegionQuery.eq("city_slug", citySlug) : sameRegionQuery.is("city_slug", null);

    const [sameRegion, sameCity, redirected] = await Promise.all([
      sameRegionQuery.order("slug", { ascending: true }).range(0, 199),
      citySlug
        ? fetchAllRows<CandidateRow>((from, to) =>
            supabase
              .from("landing_pages")
              .select(CANDIDATE_SELECT)
              .eq("status", "public")
              .eq("city_slug", citySlug)
              .eq("keyword", keyword)
              .order("slug", { ascending: true })
              .range(from, to)
          )
        : Promise.resolve({ data: [] as CandidateRow[], error: null }),
      getRedirectedSlugs(),
    ]);

    if (sameRegion.error || sameCity.error) {
      console.error("[local-pages] related select error:", sameRegion.error?.message ?? sameCity.error);
      return EMPTY_LINKS;
    }

    const candidates = [...((sameRegion.data as unknown as CandidateRow[]) ?? []), ...sameCity.data].map((row) =>
      toCandidate(row, redirected)
    );
    return selectRelatedLinks(page, candidates);
  } catch (err) {
    console.error("[local-pages] client error:", err instanceof Error ? err.message : err);
    return EMPTY_LINKS;
  }
}

interface HubRow {
  slug: string;
  title: string;
  business_name: string;
  region: string | null;
  keyword: string | null;
  city: string | null;
  city_slug: string | null;
  updated_at: string | null;
  published_at: string | null;
  created_at: string;
  seo: { seo_noindex: boolean } | null;
}

const toHubEntry = (row: HubRow, redirected: ReadonlySet<string>): HubPageEntry => ({
  slug: row.slug,
  title: row.title,
  region: row.region,
  keyword: row.keyword,
  city: row.city,
  city_slug: row.city_slug,
  updated_at: row.updated_at,
  published_at: row.published_at,
  created_at: row.created_at,
  noindex: row.seo?.seo_noindex === true || redirected.has(row.slug),
});

/** 지역 모음 페이지(/area/{citySlug}) 데이터. 공개+noindex 아닌 페이지가 없으면 null */
export async function getAreaHub(
  citySlug: string
): Promise<{ hub: AreaHub | null; businessNames: string[]; error: string | null }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await fetchAllRows<HubRow>((from, to) =>
      supabase
        .from("landing_pages")
        .select(
          "slug, title, business_name, region, keyword, city, city_slug, updated_at, published_at, created_at, seo:landing_page_seo_settings(seo_noindex)"
        )
        .eq("status", "public")
        .eq("city_slug", citySlug)
        .order("slug", { ascending: true })
        .range(from, to)
    );
    if (error) {
      console.error("[local-pages] hub select error:", error);
      return { hub: null, businessNames: [], error: "지역 모음 페이지를 불러오지 못했습니다." };
    }
    const redirected = await getRedirectedSlugs();
    const [hub] = buildAreaHubs(data.map((row) => toHubEntry(row, redirected)));
    const indexable = data.filter((row) => row.seo?.seo_noindex !== true && !redirected.has(row.slug));
    return {
      hub: hub ?? null,
      businessNames: Array.from(new Set(indexable.map((row) => row.business_name.trim()))),
      error: null,
    };
  } catch (err) {
    console.error("[local-pages] client error:", err instanceof Error ? err.message : err);
    return { hub: null, businessNames: [], error: "지역 모음 페이지를 불러오지 못했습니다." };
  }
}

export interface PublishedUrl {
  /** landing_pages.id(수집 요청 완료 체크에 씀) */
  id: string;
  url: string;
  slug: string;
  publishedAt: string;
}

/**
 * 한국 날짜 하루 동안 대기열에서 공개된 페이지 주소(공개 시각 순). 지금도 공개 중인 것만.
 * 네이버 서치어드바이저 "웹 페이지 수집 요청"에 한 줄에 하나씩 붙여넣는 용도.
 */
export async function getPublishedUrlsForDate(
  date: string
): Promise<{ data: PublishedUrl[]; error: string | null }> {
  try {
    const { start, end } = kstDayRange(date);
    const supabase = await getSupabaseServerClient();
    const { data, error } = await fetchAllRows<{ id: string; slug: string; published_at: string }>((from, to) =>
      supabase
        .from("landing_pages")
        .select("slug, published_at, id")
        .eq("status", "public")
        .gte("published_at", start)
        .lt("published_at", end)
        .order("published_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (error) {
      console.error("[local-pages] published urls select error:", error);
      return { data: [], error: "공개된 주소를 불러오지 못했습니다." };
    }
    return {
      data: data.map((row) => ({
        id: row.id,
        url: getAbsoluteUrl(`/${row.slug}`),
        slug: row.slug,
        publishedAt: row.published_at,
      })),
      error: null,
    };
  } catch (err) {
    console.error("[local-pages] client error:", err instanceof Error ? err.message : err);
    return { data: [], error: "공개된 주소를 불러오지 못했습니다." };
  }
}
