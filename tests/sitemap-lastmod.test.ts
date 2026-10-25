/**
 * 6단계: sitemap lastmod = published_at과 updated_at 중 최신.
 */
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { getSitemapLastModified } from "@/lib/sitemap-lastmod";
import { FakeSupabase } from "./helpers/fake-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";

describe("getSitemapLastModified", () => {
  it.each([
    ["공개가 더 늦으면 공개 시각", "2026-10-23T00:00:00.000Z", "2026-10-20T00:00:00.000Z", "2026-10-23T00:00:00.000Z"],
    ["수정이 더 늦으면 수정 시각", "2026-10-01T00:00:00.000Z", "2026-10-22T05:00:00.000Z", "2026-10-22T05:00:00.000Z"],
    ["공개 시각이 없으면(직접 만든 페이지) 수정 시각", null, "2026-10-22T05:00:00.000Z", "2026-10-22T05:00:00.000Z"],
    ["날짜가 아닌 값은 무시", "not-a-date", "2026-10-22T05:00:00.000Z", "2026-10-22T05:00:00.000Z"],
  ])("%s", (_name, publishedAt, updatedAt, expected) => {
    expect(
      getSitemapLastModified({ published_at: publishedAt, updated_at: updatedAt, created_at: "2026-01-01T00:00:00.000Z" }).toISOString()
    ).toBe(expected);
  });

  it("둘 다 없으면 생성 시각", () => {
    expect(
      getSitemapLastModified({ published_at: null, updated_at: null, created_at: "2026-01-01T00:00:00.000Z" }).toISOString()
    ).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("sitemap.xml 항목의 lastmod", () => {
  it("페이지마다 published_at·updated_at 중 최신을 쓴다", async () => {
    setFakeSupabase(
      new FakeSupabase({
        tables: {
          landing_pages: [
            {
              id: "p1",
              slug: "queue-page",
              status: "public",
              created_at: "2026-10-01T00:00:00.000Z",
              updated_at: "2026-10-01T00:00:00.000Z",
              published_at: "2026-10-23T00:00:00.000Z",
            },
            {
              id: "p2",
              slug: "edited-page",
              status: "public",
              created_at: "2026-09-01T00:00:00.000Z",
              updated_at: "2026-10-22T09:30:00.000Z",
              published_at: "2026-10-02T00:00:00.000Z",
            },
            {
              id: "p3",
              slug: "manual-page",
              status: "public",
              created_at: "2026-08-01T00:00:00.000Z",
              updated_at: "2026-08-05T00:00:00.000Z",
              published_at: null,
            },
          ],
          landing_page_seo_settings: [],
        },
        relations: {
          landing_pages: {
            landing_page_seo_settings: { kind: "one", localKey: "id", foreignKey: "landing_page_id" },
          },
        },
      })
    );

    const entries = (await sitemap()).filter((e) => e.url !== "https://example.test/");
    const lastmod = Object.fromEntries(
      entries.map((e) => [e.url.replace("https://example.test/", ""), (e.lastModified as Date).toISOString()])
    );
    expect(lastmod).toEqual({
      "queue-page": "2026-10-23T00:00:00.000Z",
      "edited-page": "2026-10-22T09:30:00.000Z",
      "manual-page": "2026-08-05T00:00:00.000Z",
    });
  });
});
