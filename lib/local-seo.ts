/**
 * 지역 키워드 검색에 맞춘 SEO 도우미(순수 함수). 공개 페이지·지역 모음 페이지·sitemap이 함께 쓴다.
 *
 * 네이버·구글 가이드 범위 안에서만 다룬다: 제목·H1에 "지역 + 키워드"를 자연스럽게 앞쪽에,
 * 사진 설명(alt), 화면에 실제로 보이는 내용과 같은 구조화 데이터, 관련 페이지끼리의 내부 링크.
 * 키워드를 억지로 반복하거나 숨긴 텍스트를 넣지 않는다.
 */

export interface LocalPageInfo {
  slug: string;
  title: string;
  business_name: string;
  region: string | null;
  keyword: string | null;
  city: string | null;
  city_slug: string | null;
  main_image_alt?: string | null;
}

const clean = (value: string | null | undefined) => (value ?? "").trim();

/** "지역 키워드" (둘 중 하나라도 없으면 빈 문자열) */
export function regionKeywordPhrase(page: Pick<LocalPageInfo, "region" | "keyword">): string {
  const region = clean(page.region);
  const keyword = clean(page.keyword);
  return region && keyword ? `${region} ${keyword}` : "";
}

/**
 * H1·자동 SEO 제목에 쓰는 머리말. 제목에 지역과 키워드가 이미 들어 있으면 그대로 두고,
 * 빠진 것만 앞에 붙인다(같은 말을 두 번 쓰지 않는다).
 * 예) 제목 "원케어 헬스" + 산본동·헬스장 → "산본동 헬스장 원케어 헬스"
 *     제목 "산본동 헬스장 원케어"        → 그대로
 *     제목 "헬스장 원케어"               → "산본동 헬스장 원케어"
 *     제목 "산본동 원케어"               → "산본동 헬스장 원케어"
 */
export function buildHeadline(title: string, region: string | null, keyword: string | null): string {
  const t = title.trim();
  const r = clean(region);
  const k = clean(keyword);
  if (!r || !k) return t;
  const hasRegion = t.includes(r);
  const hasKeyword = t.includes(k);
  if (hasRegion && hasKeyword) return t;
  if (hasKeyword) return `${r} ${t}`;
  // 지역만 있으면 지역을 빼고 "지역 키워드"를 앞에 둔다: "산본동 원케어" → "산본동 헬스장 원케어"
  if (hasRegion) return `${r} ${k} ${t.replace(r, "").replace(/\s+/g, " ").trim()}`.trim();
  return `${r} ${k} ${t}`.trim();
}

/** 대표 사진 alt: 입력한 설명 → "지역 키워드 현장" → "업체명 대표 이미지" */
export function buildImageAlt(page: Pick<LocalPageInfo, "region" | "keyword" | "business_name" | "main_image_alt">): string {
  const manual = clean(page.main_image_alt);
  if (manual) return manual;
  const phrase = regionKeywordPhrase(page);
  if (phrase) return `${phrase} 현장`;
  return `${page.business_name.trim()} 대표 이미지`;
}

export function areaHubPath(citySlug: string): string {
  return `/area/${citySlug}`;
}

// ------------------------------------------------------------
// 내부 링크
// ------------------------------------------------------------

export const RELATED_LINK_LIMIT = 5;

export interface RelatedCandidate extends LocalPageInfo {
  /** 공개 중이고 noindex가 아닌 페이지만 후보가 된다(조회하는 쪽이 status=public으로 거른다) */
  noindex: boolean;
}

export interface RelatedLink {
  href: string;
  label: string;
}

export interface RelatedLinks {
  /** 같은 지역 다른 서비스(최대 5) */
  sameRegion: RelatedLink[];
  /** 근처 지역 같은 서비스 — 같은 시/군의 다른 지역(최대 5) */
  nearby: RelatedLink[];
  /** 지역 모음 페이지 */
  hub: RelatedLink | null;
}

const linkOf = (page: LocalPageInfo): RelatedLink => ({
  href: `/${page.slug}`,
  label: regionKeywordPhrase(page) || page.title,
});

/**
 * 내부 링크 고르기.
 * - 같은 지역 다른 서비스: 지역이 같고(시/군도 같아야 함 — "중앙동"처럼 이름이 같은 다른 동네 방지)
 *   키워드가 다른 페이지. 키워드 가나다순.
 * - 근처 지역 같은 서비스: 시/군이 같고 키워드가 같은데 지역이 다른 페이지. 위치 정보가 없어
 *   "가까운 순"은 알 수 없으므로, 지역 가나다순 목록에서 현재 지역 다음부터 돌아가며 고른다
 *   (모든 페이지가 같은 5개만 가리키지 않고 링크가 고르게 퍼지도록).
 * - 지역 모음 페이지: 시/군이 있으면 링크(현재 페이지가 공개 중이면 모음 페이지에 최소 1개가 있음).
 * 자기 자신, noindex 페이지, 같은 지역·키워드 중복은 뺀다.
 */
export function selectRelatedLinks(
  current: LocalPageInfo,
  candidates: readonly RelatedCandidate[],
  limit = RELATED_LINK_LIMIT
): RelatedLinks {
  const region = clean(current.region);
  const keyword = clean(current.keyword);
  const citySlug = clean(current.city_slug);
  const usable = candidates.filter((c) => !c.noindex && c.slug !== current.slug);
  const sameCity = (c: RelatedCandidate) => clean(c.city_slug) === citySlug;

  const seenKeywords = new Set<string>();
  const sameRegion = region
    ? usable
        .filter((c) => clean(c.region) === region && sameCity(c) && clean(c.keyword) && clean(c.keyword) !== keyword)
        .sort((a, b) => clean(a.keyword).localeCompare(clean(b.keyword), "ko") || a.slug.localeCompare(b.slug))
        .filter((c) => {
          const k = clean(c.keyword);
          if (seenKeywords.has(k)) return false;
          seenKeywords.add(k);
          return true;
        })
        .slice(0, limit)
        .map(linkOf)
    : [];

  let nearby: RelatedLink[] = [];
  if (citySlug && keyword) {
    const seenRegions = new Set<string>();
    const others = usable
      .filter((c) => sameCity(c) && clean(c.keyword) === keyword && clean(c.region) && clean(c.region) !== region)
      .sort((a, b) => clean(a.region).localeCompare(clean(b.region), "ko") || a.slug.localeCompare(b.slug))
      .filter((c) => {
        const r = clean(c.region);
        if (seenRegions.has(r)) return false;
        seenRegions.add(r);
        return true;
      });
    const start = others.findIndex((c) => clean(c.region).localeCompare(region, "ko") > 0);
    const rotated = start <= 0 ? others : [...others.slice(start), ...others.slice(0, start)];
    nearby = rotated.slice(0, limit).map(linkOf);
  }

  const hub =
    citySlug && clean(current.city)
      ? { href: areaHubPath(citySlug), label: `${clean(current.city)} 지역 모음` }
      : null;

  return { sameRegion, nearby, hub };
}

// ------------------------------------------------------------
// 지역 모음(허브) 페이지
// ------------------------------------------------------------

export interface HubPageEntry {
  slug: string;
  title: string;
  region: string | null;
  keyword: string | null;
  city: string | null;
  city_slug: string | null;
  updated_at: string | null;
  published_at: string | null;
  created_at: string;
  noindex: boolean;
}

export interface AreaHub {
  city: string;
  citySlug: string;
  /** 키워드 가나다순, 각 키워드 안은 지역 가나다순 */
  groups: { keyword: string; pages: { href: string; label: string; region: string }[] }[];
  pageCount: number;
  /** 모음에 들어간 페이지 중 가장 최근 수정·공개 시각 */
  lastModified: Date;
}

const latest = (e: HubPageEntry) =>
  Math.max(
    ...[e.published_at, e.updated_at, e.created_at].map((v) => (v ? Date.parse(v) : Number.NaN)).filter(Number.isFinite)
  );

/** 페이지 목록을 시/군별 모음으로 묶는다. noindex·시/군 없는 페이지는 빼고, 1개 이상인 시/군만 */
export function buildAreaHubs(entries: readonly HubPageEntry[]): AreaHub[] {
  const byCity = new Map<string, HubPageEntry[]>();
  for (const e of entries) {
    const citySlug = clean(e.city_slug);
    if (!citySlug || !clean(e.city) || e.noindex) continue;
    byCity.set(citySlug, [...(byCity.get(citySlug) ?? []), e]);
  }

  return Array.from(byCity.entries())
    .map(([citySlug, pages]) => {
      const groupsMap = new Map<string, AreaHub["groups"][number]["pages"]>();
      for (const p of pages) {
        const keyword = clean(p.keyword) || "기타";
        groupsMap.set(keyword, [
          ...(groupsMap.get(keyword) ?? []),
          { href: `/${p.slug}`, label: regionKeywordPhrase(p) || p.title, region: clean(p.region) },
        ]);
      }
      const groups = Array.from(groupsMap.entries())
        .sort(([a], [b]) => a.localeCompare(b, "ko"))
        .map(([keyword, list]) => ({
          keyword,
          pages: list.sort((a, b) => a.region.localeCompare(b.region, "ko") || a.href.localeCompare(b.href)),
        }));
      // 같은 city_slug에 시/군 이름이 다르게 들어온 경우 가장 많이 쓴 이름을 쓴다.
      const nameCounts = new Map<string, number>();
      for (const p of pages) nameCounts.set(clean(p.city), (nameCounts.get(clean(p.city)) ?? 0) + 1);
      const city = Array.from(nameCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))[0][0];
      return {
        city,
        citySlug,
        groups,
        pageCount: pages.length,
        lastModified: new Date(Math.max(...pages.map(latest))),
      };
    })
    .sort((a, b) => a.citySlug.localeCompare(b.citySlug));
}

// ------------------------------------------------------------
// 경로(Breadcrumb)
// ------------------------------------------------------------

export interface BreadcrumbItem {
  name: string;
  /** 사이트 내부 경로("/", "/area/gunpo", "/slug") */
  path: string;
}

export const HOME_BREADCRUMB: BreadcrumbItem = { name: "홈", path: "/" };

/**
 * 홈 › 시/군 모음 › 현재 페이지. 사이트 루트(/)가 공개 홈이 되어(SEO·GEO 작업) "홈"을 다시 넣는다.
 * 시/군이 없으면 "홈 › 현재 페이지"(2개 — Google BreadcrumbList 최소 개수).
 */
export function buildPageBreadcrumbs(page: LocalPageInfo, headline: string): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [HOME_BREADCRUMB];
  const citySlug = clean(page.city_slug);
  const city = clean(page.city);
  if (citySlug && city) items.push({ name: city, path: areaHubPath(citySlug) });
  items.push({ name: headline, path: `/${page.slug}` });
  return items;
}

/** 지역 모음 페이지 경로: 홈 › 시/군 */
export function buildHubBreadcrumbs(hub: Pick<AreaHub, "city" | "citySlug">): BreadcrumbItem[] {
  return [HOME_BREADCRUMB, { name: hub.city, path: areaHubPath(hub.citySlug) }];
}
