/**
 * 301 이동(feature/redirects)
 * 1) migration 020 landing_page_redirects: 형식·자기 자신·연쇄·순환·새 주소 확인, 권한(anon 읽기만), 되돌리기
 * 2) proxy: 옛 주소 → 새 주소 301(쿼리 유지), 예약 경로·하위 경로·POST는 건너뜀, 목록을 못 읽으면 이동 안 함
 * 3) 옛 주소는 sitemap·홈 목록·허브·내부 링크에서 빠짐
 * 4) 관리자 '주소 이동' 화면
 * 5) meta description·구조화 데이터의 "#" 제거(화면 본문은 그대로)
 * 컴퓨터 안 Postgres(PGlite, migration 001~020)만 쓴다 — 운영 DB에는 연결하지 않는다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { asRole, createMigratedDb, readMigration, readRollback } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";
import type { LandingPage } from "@/types/landing-page";

let db: PGliteInterface;
let proxyClientFails = false;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    if (proxyClientFails) throw new Error("network down");
    return new PgliteSupabase(db, "anon");
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

const { buildRedirectMap, findRedirectPath, slugFromPathname } = await import("@/lib/redirect-map");
const { redirectLandingPage, resetRedirectCacheForTest, getRedirectMap, REDIRECT_CACHE_TTL_MS } = await import(
  "@/lib/supabase/redirect-proxy"
);
const { getPublicLandingPagesForSitemap } = await import("@/lib/landing-pages");
const { getAreaHub, getRelatedLinks } = await import("@/lib/local-pages");
const { listRedirectsForAdmin } = await import("@/lib/redirects");
const { default: AdminRedirectsPage } = await import("@/app/admin/redirects/page");
const { stripHashMarks, toPlainSummary } = await import("@/lib/business-info");
const { buildSeoDescription } = await import("@/lib/seo-auto");
const { resolveLandingPageSeo } = await import("@/lib/seo-resolver");
const { buildOrganizationJsonLd, buildSiteBusinessJsonLd, buildWebPageJsonLd } = await import(
  "@/lib/structured-data"
);

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

let base: PGlite;

beforeAll(async () => {
  base = await createMigratedDb();
}, 60_000);

afterAll(async () => {
  await base.close();
});

beforeEach(async () => {
  db = await base.clone();
  setFakeSupabase(new PgliteSupabase(db));
  resetRedirectCacheForTest();
  proxyClientFails = false;
});

interface PageValues {
  status?: "public" | "private";
  region?: string;
  keyword?: string;
  city?: string;
  citySlug?: string;
  noindex?: boolean;
}

async function insertPage(slug: string, values: PageValues = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.landing_pages (business_name, title, slug, status, region, keyword, city, city_slug)
     values ('원케어배관', $1, $1, $2, $3, $4, $5, $6) returning id`,
    [slug, values.status ?? "public", values.region ?? null, values.keyword ?? null, values.city ?? null, values.citySlug ?? null]
  );
  if (values.noindex) {
    await db.query(`insert into public.landing_page_seo_settings (landing_page_id, seo_noindex) values ($1, true)`, [
      rows[0].id,
    ]);
  }
  return rows[0].id;
}

async function addRedirect(from: string, to: string, note = "") {
  await db.query(`insert into public.landing_page_redirects (from_slug, to_slug, note) values ($1, $2, $3)`, [
    from,
    to,
    note,
  ]);
}

async function redirectError(from: string, to: string): Promise<string> {
  try {
    await addRedirect(from, to);
  } catch (err) {
    return (err as Error).message;
  }
  return "";
}

describe("migration 020 landing_page_redirects", () => {
  it("공개 중인 새 주소로는 이동을 넣을 수 있다(옛 페이지가 없어도 됨)", async () => {
    await insertPage("keep-page");
    await addRedirect("old-page", "keep-page", "정왕동 하수구 합침");
    const { rows } = await db.query<{ from_slug: string; to_slug: string; note: string }>(
      "select from_slug, to_slug, note from public.landing_page_redirects"
    );
    expect(rows).toEqual([{ from_slug: "old-page", to_slug: "keep-page", note: "정왕동 하수구 합침" }]);
  });

  it("자기 자신·slug 형식이 아닌 주소·200자 넘는 메모는 막는다", async () => {
    await insertPage("keep-page");
    expect(await redirectError("keep-page", "keep-page")).toMatch(/landing_page_redirects_not_self/);
    expect(await redirectError("Old Page", "keep-page")).toMatch(/from_slug_format/);
    // 새 주소 형식은 check 제약보다 먼저 도는 트리거가 "공개 페이지 없음"으로 거절한다
    expect(await redirectError("old", "/keep-page")).not.toBe("");
    await expect(
      db.exec(`alter table public.landing_page_redirects disable trigger landing_page_redirects_check;
               insert into public.landing_page_redirects (from_slug, to_slug) values ('old', '/keep-page');`)
    ).rejects.toThrow(/to_slug_format/);
    await expect(addRedirect("old", "keep-page", "가".repeat(201))).rejects.toThrow(/note_length/);
  });

  it("새 주소에 공개 페이지가 없거나 비공개면 막는다", async () => {
    await insertPage("hidden-page", { status: "private" });
    expect(await redirectError("old", "no-such-page")).toContain("공개 중인 랜딩페이지가 없습니다");
    expect(await redirectError("old", "hidden-page")).toContain("공개 중인 랜딩페이지가 없습니다");
  });

  it("연쇄 이동을 양쪽 방향 모두 막는다", async () => {
    await insertPage("b-page");
    await insertPage("c-page");
    await addRedirect("a-page", "b-page");
    // a→b가 있는데 b→c: 새 주소가 아니라 옛 주소(b)가 다른 항목의 새 주소
    expect(await redirectError("b-page", "c-page")).toContain("이동하는 항목이 이미 있습니다");
    // a→b가 있는데 x→a: 새 주소(a)가 이미 이동된 옛 주소
    expect(await redirectError("x-page", "a-page")).toContain("이미 다른 곳으로 이동된");
  });

  it("순환 이동(a→b, b→a)을 막는다", async () => {
    await insertPage("a-page");
    await insertPage("b-page");
    await addRedirect("a-page", "b-page");
    expect(await redirectError("b-page", "a-page")).toMatch(/연쇄 이동 금지/);
  });

  it("수정할 때도 같은 규칙: 자기 행은 빼고 검사한다", async () => {
    await insertPage("b-page");
    await insertPage("c-page");
    await addRedirect("a-page", "b-page");
    await db.query("update public.landing_page_redirects set to_slug = 'c-page' where from_slug = 'a-page'");
    await addRedirect("d-page", "b-page");
    await expect(
      db.query("update public.landing_page_redirects set to_slug = 'a-page' where from_slug = 'd-page'")
    ).rejects.toThrow(/이미 다른 곳으로 이동된/);
  });

  it("anon·authenticated는 읽기만 된다(쓰기는 SQL로만)", async () => {
    await insertPage("keep-page");
    await addRedirect("old-page", "keep-page");
    for (const role of ["anon", "authenticated"] as const) {
      const { rows } = await asRole(db, role, (tx) => tx.query("select from_slug from public.landing_page_redirects"));
      expect(rows).toHaveLength(1);
      await expect(
        asRole(db, role, (tx) =>
          tx.query("insert into public.landing_page_redirects (from_slug, to_slug) values ('x-page', 'keep-page')")
        )
      ).rejects.toThrow(/row-level security/);
      await asRole(db, role, (tx) => tx.query("delete from public.landing_page_redirects"));
    }
    const { rows } = await db.query("select from_slug from public.landing_page_redirects");
    expect(rows).toHaveLength(1);
  });

  it("두 번 적용해도 되고, 되돌리기는 테이블·함수를 지운다", async () => {
    await insertPage("keep-page");
    await addRedirect("old-page", "keep-page");
    await db.exec(readMigration("020_landing_page_redirects.sql"));
    expect((await db.query("select * from public.landing_page_redirects")).rows).toHaveLength(1);
    await db.exec(readRollback("020_down.sql"));
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int n from pg_proc where proname = 'check_landing_page_redirect'
       union all select count(*)::int from pg_class where relname = 'landing_page_redirects'`
    );
    expect(rows.map((row) => row.n)).toEqual([0, 0]);
  });
});

describe("이동 목록 함수", () => {
  it("연쇄·순환·자기 자신은 지도에서 뺀다(DB 밖 데이터 대비)", () => {
    const map = buildRedirectMap([
      { from_slug: "a", to_slug: "b" },
      { from_slug: "b", to_slug: "c" },
      { from_slug: "x", to_slug: "y" },
      { from_slug: "y", to_slug: "x" },
      { from_slug: "s", to_slug: "s" },
      { from_slug: "old", to_slug: "new" },
    ]);
    expect(Object.fromEntries(map)).toEqual({ b: "c", old: "new" });
  });

  it("한 단어 slug 경로만 이동 대상(예약 주소·하위 경로·파일 제외)", () => {
    expect(slugFromPathname("/old-page")).toBe("old-page");
    expect(slugFromPathname("/old-page/")).toBe("old-page");
    for (const path of ["/", "/admin", "/admin-x", "/login", "/api", "/area", "/area/gunpo", "/llms.txt", "/sitemap.xml", "/Old"]) {
      expect(slugFromPathname(path)).toBeNull();
    }
    expect(findRedirectPath(new Map([["old-page", "keep-page"]]), "/old-page")).toBe("/keep-page");
    expect(findRedirectPath(new Map([["old-page", "keep-page"]]), "/keep-page")).toBeNull();
  });
});

describe("proxy 301 이동", () => {
  it("옛 주소는 새 주소로 301, 쿼리 문자열 유지", async () => {
    await insertPage("keep-page");
    await addRedirect("old-page", "keep-page");
    const response = await redirectLandingPage(new NextRequest("https://onecarepage.co.kr/old-page?utm_source=naver"));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://onecarepage.co.kr/keep-page?utm_source=naver");
  });

  it("이동 목록에 없는 주소·POST·하위 경로는 그대로 둔다", async () => {
    await insertPage("keep-page");
    await addRedirect("old-page", "keep-page");
    expect(await redirectLandingPage(new NextRequest("https://onecarepage.co.kr/keep-page"))).toBeNull();
    expect(
      await redirectLandingPage(new NextRequest("https://onecarepage.co.kr/old-page", { method: "POST" }))
    ).toBeNull();
    expect(await redirectLandingPage(new NextRequest("https://onecarepage.co.kr/area/old-page"))).toBeNull();
  });

  it("목록을 못 읽으면 이동하지 않는다(020 적용 전·접속 실패)", async () => {
    await insertPage("keep-page");
    await db.exec(readRollback("020_down.sql"));
    expect(await redirectLandingPage(new NextRequest("https://onecarepage.co.kr/old-page"))).toBeNull();
    resetRedirectCacheForTest();
    proxyClientFails = true;
    expect(await redirectLandingPage(new NextRequest("https://onecarepage.co.kr/old-page"))).toBeNull();
  });

  it("목록은 60초 기억하고, 지나면 다시 읽는다", async () => {
    await insertPage("keep-page");
    const now = 1_000_000;
    expect((await getRedirectMap(now)).size).toBe(0);
    await addRedirect("old-page", "keep-page");
    expect((await getRedirectMap(now + 1_000)).size).toBe(0);
    expect((await getRedirectMap(now + REDIRECT_CACHE_TTL_MS + 1)).get("old-page")).toBe("keep-page");
  });

  it("1,000개가 넘어도 끝까지 읽는다", async () => {
    await insertPage("keep-page");
    await db.exec(`
      alter table public.landing_page_redirects disable trigger landing_page_redirects_check;
      insert into public.landing_page_redirects (from_slug, to_slug)
        select 'old-' || g, 'keep-page' from generate_series(1, 1205) g;
      alter table public.landing_page_redirects enable trigger landing_page_redirects_check;
    `);
    expect((await getRedirectMap()).size).toBe(1205);
  });
});

describe("옛 주소는 공개 목록에서 빠진다", () => {
  beforeEach(async () => {
    const local = { city: "시흥시", citySlug: "siheung", keyword: "하수구막힘" };
    await insertPage("siheung-jeongwang-keep", { ...local, region: "정왕동" });
    await insertPage("siheung-jeongwang-old", { ...local, region: "정왕동" });
    await insertPage("siheung-jeongwang-septic", { ...local, region: "정왕동", keyword: "정화조막힘" });
    await insertPage("siheung-baegot", { ...local, region: "배곧동" });
    await addRedirect("siheung-jeongwang-old", "siheung-jeongwang-keep");
  });

  it("sitemap·홈·llms.txt 목록", async () => {
    const { data, error } = await getPublicLandingPagesForSitemap();
    expect(error).toBeNull();
    expect(data.map((page) => page.slug).sort()).toEqual([
      "siheung-baegot",
      "siheung-jeongwang-keep",
      "siheung-jeongwang-septic",
    ]);
  });

  it("지역 모음 페이지", async () => {
    const { hub } = await getAreaHub("siheung");
    const hrefs = hub?.groups.flatMap((group) => group.pages.map((page) => page.href)) ?? [];
    expect(hrefs).toContain("/siheung-jeongwang-keep");
    expect(hrefs).not.toContain("/siheung-jeongwang-old");
    expect(hub?.pageCount).toBe(3);
  });

  it("내부 링크", async () => {
    const links = await getRelatedLinks({
      slug: "siheung-jeongwang-septic",
      title: "정화조",
      business_name: "원케어배관",
      region: "정왕동",
      keyword: "정화조막힘",
      city: "시흥시",
      city_slug: "siheung",
    });
    const hrefs = links.sameRegion.map((link) => link.href);
    expect(hrefs).toContain("/siheung-jeongwang-keep");
    expect(hrefs).not.toContain("/siheung-jeongwang-old");
  });

  it("이동 테이블이 없으면(020 적용 전) 예전처럼 모두 나온다", async () => {
    await db.exec(readRollback("020_down.sql"));
    const { data } = await getPublicLandingPagesForSitemap();
    expect(data).toHaveLength(4);
  });
});

describe("관리자 '주소 이동' 화면", () => {
  it("목록·양쪽 페이지 상태·확인 필요 표시", async () => {
    await insertPage("keep-page");
    await insertPage("old-page");
    await insertPage("later-hidden");
    await insertPage("later-noindex");
    await addRedirect("old-page", "keep-page", "중복 합침");
    await addRedirect("gone-page", "later-hidden");
    await addRedirect("other-old", "later-noindex");
    await db.query("update public.landing_pages set status = 'private' where slug = 'later-hidden'");
    await db.query(
      `insert into public.landing_page_seo_settings (landing_page_id, seo_noindex)
       select id, true from public.landing_pages where slug = 'later-noindex'`
    );

    const { data, error } = await listRedirectsForAdmin();
    expect(error).toBeNull();
    expect(data.map((item) => [item.fromSlug, item.fromState, item.toState, item.problem])).toEqual([
      ["gone-page", "missing", "private", "새 주소 페이지가 비공개"],
      ["old-page", "public", "public", null],
      ["other-old", "missing", "public", "새 주소 페이지가 검색 제외(noindex)"],
    ]);

    const html = text(renderToStaticMarkup(await AdminRedirectsPage()));
    expect(html).toContain("이동 3 개");
    expect(html).toContain("확인 필요 2개");
    expect(html).toContain("/old-page");
    expect(html).toContain("중복 합침");
  });

  it("테이블이 없으면 안내 문구", async () => {
    await db.exec(readRollback("020_down.sql"));
    const html = text(renderToStaticMarkup(await AdminRedirectsPage()));
    expect(html).toContain("migration 020이 적용되었는지 확인해 주세요");
  });
});

describe('meta description·구조화 데이터의 "#" 제거', () => {
  const page = (values: Partial<LandingPage>) =>
    ({
      id: "p1",
      slug: "septic-0001",
      title: "권선동정화조막힘",
      business_name: "원케어배관",
      description: null,
      hero_text: null,
      address: null,
      phone: null,
      updated_at: "2026-10-30T00:00:00Z",
      ...values,
    }) as LandingPage;

  it("마크다운 제목 기호·낱개 #와 앞뒤 공백", () => {
    expect(stripHashMarks("### 권선동정화조막힘, 배수불량")).toBe("권선동정화조막힘, 배수불량");
    expect(stripHashMarks("깨끗하게! # 정왕동유리창청소, 상가")).toBe("깨끗하게! 정왕동유리창청소, 상가");
    expect(stripHashMarks("끝 ##")).toBe("끝");
    // 해시태그는 예전처럼 낱말째 빠진다
    expect(toPlainSummary("# 제목\n본문 #시흥하수구 끝")).toBe("제목 본문 끝");
  });

  it("자동 설명·직접 입력 설명·구조화 데이터 모두, 화면 본문은 그대로", () => {
    const landing = page({ description: "### 권선동정화조막힘, 배수불량과 오수 역류" });
    expect(buildSeoDescription(landing)).toBe("권선동정화조막힘, 배수불량과 오수 역류");
    expect(landing.description).toBe("### 권선동정화조막힘, 배수불량과 오수 역류");

    const manual = resolveLandingPageSeo(landing, {
      seo_description: "# 직접 쓴 설명",
      og_description: "## 공유 설명",
    } as never);
    expect(manual.description).toBe("직접 쓴 설명");
    expect(manual.ogDescription).toBe("공유 설명");
    expect(buildWebPageJsonLd(landing, manual).description).toBe("직접 쓴 설명");

    const site = { businessName: "원케어배관", description: "### 배관 전문", phone: null, kakaoUrl: null };
    const auto = resolveLandingPageSeo(landing, null);
    expect(buildOrganizationJsonLd(landing, auto, site).description).toBe("배관 전문");
    expect(buildSiteBusinessJsonLd(site, [])?.description).toBe("배관 전문");
    expect(buildSiteBusinessJsonLd({ ...site, description: " ### " }, [])).not.toHaveProperty("description");
  });
});
