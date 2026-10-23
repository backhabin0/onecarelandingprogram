import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminDashboardPage from "@/app/admin/page";
import { getLandingPageCounts } from "@/lib/landing-pages";
import { buildFixture, createFakeSupabase, SIZES } from "./helpers/fixtures";
import { setFakeSupabase } from "./helpers/current-supabase";

describe("대시보드 count", () => {
  it.each(SIZES)("랜딩 %i개의 전체/공개/비공개 숫자가 정확하다(count 쿼리만 사용)", async (n) => {
    const fixture = buildFixture(n);
    const fake = setFakeSupabase(createFakeSupabase(fixture));

    const { data, error } = await getLandingPageCounts();

    expect(error).toBeNull();
    expect(data).toEqual({
      total: n,
      public: fixture.landingPages.filter((lp) => lp.status === "public").length,
      private: fixture.landingPages.filter((lp) => lp.status === "private").length,
    });
    // 행 데이터를 가져오지 않고 head count 요청 3번만 한다.
    expect(fake.requests).toHaveLength(3);
    expect(fake.requests.every((r) => r.head && r.count)).toBe(true);
  });

  it("2,500개 기준 화면에 2500 / 1875 / 625가 표시된다", async () => {
    setFakeSupabase(createFakeSupabase(buildFixture(2500)));
    const html = renderToStaticMarkup(await AdminDashboardPage());

    const valueOf = (label: string) => {
      const match = html.match(
        new RegExp(`${label}</p><p[^>]*>(\\d+)</p>`)
      );
      return match ? Number(match[1]) : null;
    };

    expect(valueOf("전체 랜딩페이지")).toBe(2500);
    expect(valueOf("공개 중")).toBe(1875);
    expect(valueOf("비공개")).toBe(625);
  });
});
