import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { buildFixture, createFakeSupabase, SIZES } from "./helpers/fixtures";
import { setFakeSupabase } from "./helpers/current-supabase";

describe("sitemap", () => {
  it.each(SIZES)("랜딩 %i개 중 공개 + noindex 아닌 것만 전부 포함한다", async (n) => {
    const fixture = buildFixture(n);
    const fake = setFakeSupabase(createFakeSupabase(fixture));

    const noindexIds = new Set(
      fixture.seoSettings
        .filter((seo) => seo.seo_noindex === true)
        .map((seo) => seo.landing_page_id)
    );
    const expectedSlugs = fixture.landingPages
      .filter((lp) => lp.status === "public" && !noindexIds.has(lp.id))
      .map((lp) => lp.slug as string);

    // 첫 항목은 공개 홈(/). 랜딩페이지 항목만 따로 센다.
    const [home, ...entries] = await sitemap();
    expect(home.url).toBe("https://example.test/");
    const urls = entries.map((entry) => entry.url);

    expect(entries).toHaveLength(expectedSlugs.length);
    expect(new Set(urls).size).toBe(urls.length);
    expect(new Set(urls)).toEqual(
      new Set(expectedSlugs.map((slug) => `https://example.test/${slug}`))
    );

    // 공개 페이지가 1,000개를 넘으면 반드시 여러 번 나눠 읽어야 한다.
    const publicCount = fixture.landingPages.filter((lp) => lp.status === "public").length;
    expect(fake.requests.filter((r) => r.table === "landing_pages")).toHaveLength(Math.floor(publicCount / 1000) + 1);
  });

  it("1,200개 기준 기대 개수(공개 900 - 공개 noindex 60 = 840)", async () => {
    setFakeSupabase(createFakeSupabase(buildFixture(1200)));
    // public: i % 4 !== 0 → 900개
    // noindex: i % 10 === 0 → 120개 중 public(i % 4 !== 0)인 것은 i % 20 === 10 → 60개
    const entries = await sitemap();
    expect(entries).toHaveLength(1 + 900 - 60); // 홈 1 + 랜딩
  });
});
