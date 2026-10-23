import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  getAnalyticsSummary,
  getAnalyticsTimeSeries,
  getLandingPagePerformance,
} from "@/lib/analytics";
import { buildFixture, createFakeSupabase, NOW, SIZES, type Fixture } from "./helpers/fixtures";
import { setFakeSupabase } from "./helpers/current-supabase";
import type { AnalyticsSummary } from "@/types/analytics";

// 통계 기간(이번 달)이 고정되도록 현재 시각을 한국시간 2026-10-15 12:00으로 맞춘다.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const OCTOBER_START = "2026-09-30T15:00:00.000Z";
const NOVEMBER_START = "2026-10-31T15:00:00.000Z";

function inOctober(row: Record<string, unknown>) {
  const createdAt = String(row.created_at);
  return createdAt >= OCTOBER_START && createdAt < NOVEMBER_START;
}

function expectedTotals(fixture: Fixture, landingPageId?: string | null) {
  const matches = (row: Record<string, unknown>) =>
    landingPageId === undefined ? true : (row.landing_page_id ?? null) === landingPageId;
  const events = fixture.events.filter((e) => inOctober(e) && matches(e));
  return {
    pageViews: events.filter((e) => e.event_type === "page_view").length,
    phoneClicks: events.filter((e) => e.event_type === "phone_click").length,
    kakaoClicks: events.filter((e) => e.event_type === "kakao_click").length,
    consultations: fixture.consultations.filter((c) => inOctober(c) && matches(c)).length,
  };
}

function sumPoints(points: AnalyticsSummary[]) {
  return points.reduce(
    (acc, p) => ({
      pageViews: acc.pageViews + Number(p.pageViews),
      phoneClicks: acc.phoneClicks + Number(p.phoneClicks),
      kakaoClicks: acc.kakaoClicks + Number(p.kakaoClicks),
      consultations: acc.consultations + Number(p.consultations),
    }),
    { pageViews: 0, phoneClicks: 0, kakaoClicks: 0, consultations: 0 }
  );
}

describe("통계 조회", () => {
  it.each(SIZES)("이벤트·상담 %i건: 요약 카드(count) 숫자가 정확하다", async (n) => {
    const fixture = buildFixture(n);
    setFakeSupabase(createFakeSupabase(fixture));

    const { data, error } = await getAnalyticsSummary({ period: "month", landingPageId: "all" });
    expect(error).toBeNull();
    expect(data).toEqual(expectedTotals(fixture));
  });

  it.each(SIZES)("이벤트·상담 %i건: 기간별 추이 합계가 전체 건수와 같다(1,000건에서 안 잘림)", async (n) => {
    const fixture = buildFixture(n);
    setFakeSupabase(createFakeSupabase(fixture));

    const { data, error } = await getAnalyticsTimeSeries({ period: "month", landingPageId: "all" });
    expect(error).toBeNull();
    expect(data).toHaveLength(31); // 10월 1일 ~ 31일
    expect(sumPoints(data)).toEqual(expectedTotals(fixture));
  });

  it("기간별 추이: '삭제된 랜딩페이지' 필터도 끝까지 읽는다", async () => {
    const fixture = buildFixture(2500);
    setFakeSupabase(createFakeSupabase(fixture));

    const { data } = await getAnalyticsTimeSeries({ period: "month", landingPageId: "deleted" });
    expect(sumPoints(data)).toEqual(expectedTotals(fixture, null));
  });

  it.each(SIZES)("이벤트·상담 %i건: 랜딩페이지별 성과 합계가 전체 건수와 같다", async (n) => {
    const fixture = buildFixture(n);
    setFakeSupabase(createFakeSupabase(fixture));

    const { data, error } = await getLandingPagePerformance("month");
    expect(error).toBeNull();
    expect(sumPoints(data)).toEqual(expectedTotals(fixture));

    // 랜딩페이지 행마다 업체명이 붙는다(1,000개 넘는 landing_pages도 끝까지 읽었는지 확인).
    const named = data.filter((row) => row.landingPageId !== null);
    expect(named.every((row) => row.businessName.startsWith("업체 "))).toBe(true);
    const deletedRows = data.filter((row) => row.landingPageId === null);
    expect(deletedRows.length).toBeLessThanOrEqual(1);
  });

  it("랜딩 2,500개 중 1,000번째 이후 페이지도 업체명/slug가 정확하다", async () => {
    const fixture = buildFixture(2500);
    setFakeSupabase(createFakeSupabase(fixture));

    const { data } = await getLandingPagePerformance("month");
    const row = data.find((r) => r.landingPageId === "lp-02400");
    expect(row).toMatchObject({ businessName: "업체 2400", slug: "shop-02400" });
  });
});
