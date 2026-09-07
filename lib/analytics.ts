import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AnalyticsFilters,
  AnalyticsPeriod,
  AnalyticsSummary,
  AnalyticsTimeSeriesPoint,
  LandingPageEventType,
  LandingPagePerformanceRow,
} from "@/types/analytics";

/**
 * 통계 기준 timezone. 한국 서비스이므로 UTC 경계 때문에 날짜가 틀어지지
 * 않도록 모든 기간(오늘/이번 주/이번 달) 계산을 이 timezone 기준으로 한다.
 * 한국은 DST가 없어 항상 UTC+9로 고정이므로 아래 계산은 이 상수에만 의존한다.
 */
export const ANALYTICS_TIME_ZONE = "Asia/Seoul";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 기간별 추이/랜딩페이지별 성과 집계 시 한 번에 가져오는 최대 이벤트 행 수(안전장치) */
const ANALYTICS_MAX_ROWS = 10000;

interface KstParts {
  year: number;
  month: number; // 0-indexed
  day: number;
  weekday: number; // 0 = 일요일 ... 6 = 토요일
}

function toKstParts(date: Date): KstParts {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** 한국시간 year-month-day 00:00을 실제 UTC Date로 변환한다. */
function kstMidnightToUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, -9, 0, 0, 0));
}

export interface AnalyticsPeriodRange {
  start: Date;
  end: Date;
}

/**
 * 기간(오늘/이번 주/이번 달)의 [start, end) 구간을 한국시간 기준으로 계산한다.
 * 주 시작은 월요일로 고정한다.
 */
export function getAnalyticsPeriodRange(
  period: AnalyticsPeriod,
  now: Date = new Date()
): AnalyticsPeriodRange {
  const kst = toKstParts(now);

  if (period === "day") {
    return {
      start: kstMidnightToUtc(kst.year, kst.month, kst.day),
      end: kstMidnightToUtc(kst.year, kst.month, kst.day + 1),
    };
  }

  if (period === "week") {
    const daysSinceMonday = (kst.weekday + 6) % 7; // 월=0 ... 일=6
    return {
      start: kstMidnightToUtc(kst.year, kst.month, kst.day - daysSinceMonday),
      end: kstMidnightToUtc(kst.year, kst.month, kst.day - daysSinceMonday + 7),
    };
  }

  return {
    start: kstMidnightToUtc(kst.year, kst.month, 1),
    end: kstMidnightToUtc(kst.year, kst.month + 1, 1),
  };
}

interface AnalyticsBucket {
  key: string;
  label: string;
  bucketStart: Date;
  bucketEnd: Date;
}

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * 기간을 시각화용 구간으로 나눈다. 오늘=시간대별(0~23시),
 * 이번 주=요일별(월~일 7개), 이번 달=날짜별(1일~말일).
 * 한국은 DST가 없으므로 UTC 기준으로 24시간씩 더해도 한국시간 날짜 경계와 항상 일치한다.
 */
function buildBuckets(period: AnalyticsPeriod, start: Date): AnalyticsBucket[] {
  if (period === "day") {
    return Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}시`,
      bucketStart: new Date(start.getTime() + hour * 60 * 60 * 1000),
      bucketEnd: new Date(start.getTime() + (hour + 1) * 60 * 60 * 1000),
    }));
  }

  const length = period === "week" ? 7 : daysInKstMonth(start);

  return Array.from({ length }, (_, i) => {
    const bucketStart = new Date(start.getTime() + i * DAY_IN_MS);
    const bucketEnd = new Date(bucketStart.getTime() + DAY_IN_MS);
    const kst = toKstParts(bucketStart);
    const dateLabel = `${String(kst.month + 1).padStart(2, "0")}/${String(kst.day).padStart(2, "0")}`;
    return {
      key: `${kst.year}-${String(kst.month + 1).padStart(2, "0")}-${String(kst.day).padStart(2, "0")}`,
      label: period === "week" ? `${dateLabel}(${WEEKDAY_LABELS[i]})` : dateLabel,
      bucketStart,
      bucketEnd,
    };
  });
}

function daysInKstMonth(monthStartUtc: Date): number {
  const kst = toKstParts(monthStartUtc);
  // 다음 달 0일 = 이번 달 마지막 날
  return new Date(Date.UTC(kst.year, kst.month + 1, 0)).getUTCDate();
}

function findBucketIndex(buckets: AnalyticsBucket[], timestamp: Date): number {
  return buckets.findIndex(
    (bucket) => timestamp >= bucket.bucketStart && timestamp < bucket.bucketEnd
  );
}

const EMPTY_SUMMARY: AnalyticsSummary = {
  pageViews: 0,
  phoneClicks: 0,
  kakaoClicks: 0,
  consultations: 0,
};

export interface GetAnalyticsSummaryResult {
  data: AnalyticsSummary;
  error: string | null;
}

/** 상단 요약 카드용 4개 지표를 DB count 쿼리로 집계한다(행 데이터를 가져오지 않는다). */
export async function getAnalyticsSummary(
  filters: AnalyticsFilters
): Promise<GetAnalyticsSummaryResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { start, end } = getAnalyticsPeriodRange(filters.period);

    const countEvent = (eventType: LandingPageEventType) => {
      let query = supabase
        .from("landing_page_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", eventType)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());

      if (filters.landingPageId && filters.landingPageId !== "all") {
        query =
          filters.landingPageId === "deleted"
            ? query.is("landing_page_id", null)
            : query.eq("landing_page_id", filters.landingPageId);
      }

      return query;
    };

    let consultationQuery = supabase
      .from("consultation_requests")
      .select("id", { count: "exact", head: true })
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());

    if (filters.landingPageId && filters.landingPageId !== "all") {
      consultationQuery =
        filters.landingPageId === "deleted"
          ? consultationQuery.is("landing_page_id", null)
          : consultationQuery.eq("landing_page_id", filters.landingPageId);
    }

    const [pageViewRes, phoneRes, kakaoRes, consultationRes] = await Promise.all([
      countEvent("page_view"),
      countEvent("phone_click"),
      countEvent("kakao_click"),
      consultationQuery,
    ]);

    const firstError =
      pageViewRes.error ?? phoneRes.error ?? kakaoRes.error ?? consultationRes.error;

    if (firstError) {
      console.error("[analytics] summary error:", firstError);
      return { data: EMPTY_SUMMARY, error: "통계 데이터를 불러오지 못했습니다." };
    }

    return {
      data: {
        pageViews: pageViewRes.count ?? 0,
        phoneClicks: phoneRes.count ?? 0,
        kakaoClicks: kakaoRes.count ?? 0,
        consultations: consultationRes.count ?? 0,
      },
      error: null,
    };
  } catch (err) {
    console.error("[analytics] client error:", err);
    return { data: EMPTY_SUMMARY, error: "통계 데이터를 불러오지 못했습니다." };
  }
}

export interface GetAnalyticsTimeSeriesResult {
  data: AnalyticsTimeSeriesPoint[];
  error: string | null;
}

/**
 * 기간별 추이 그래프/표용 데이터. 기간 범위로 제한된 이벤트/상담 행만
 * (최대 ANALYTICS_MAX_ROWS건) 가져와 서버에서 구간별로 집계한다 — 전체
 * 테이블을 브라우저로 보내지 않는다.
 */
export async function getAnalyticsTimeSeries(
  filters: AnalyticsFilters
): Promise<GetAnalyticsTimeSeriesResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { start, end } = getAnalyticsPeriodRange(filters.period);
    const buckets = buildBuckets(filters.period, start);

    let eventsQuery = supabase
      .from("landing_page_events")
      .select("event_type, created_at")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .limit(ANALYTICS_MAX_ROWS);

    if (filters.landingPageId && filters.landingPageId !== "all") {
      eventsQuery =
        filters.landingPageId === "deleted"
          ? eventsQuery.is("landing_page_id", null)
          : eventsQuery.eq("landing_page_id", filters.landingPageId);
    }

    let consultationsQuery = supabase
      .from("consultation_requests")
      .select("created_at")
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .limit(ANALYTICS_MAX_ROWS);

    if (filters.landingPageId && filters.landingPageId !== "all") {
      consultationsQuery =
        filters.landingPageId === "deleted"
          ? consultationsQuery.is("landing_page_id", null)
          : consultationsQuery.eq("landing_page_id", filters.landingPageId);
    }

    const [eventsRes, consultationsRes] = await Promise.all([
      eventsQuery,
      consultationsQuery,
    ]);

    if (eventsRes.error || consultationsRes.error) {
      console.error(
        "[analytics] timeseries error:",
        eventsRes.error ?? consultationsRes.error
      );
      return { data: [], error: "통계 데이터를 불러오지 못했습니다." };
    }

    const points: AnalyticsTimeSeriesPoint[] = buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      pageViews: 0,
      phoneClicks: 0,
      kakaoClicks: 0,
      consultations: 0,
    }));

    const eventRows =
      (eventsRes.data as
        | { event_type: LandingPageEventType; created_at: string }[]
        | null) ?? [];

    for (const row of eventRows) {
      const index = findBucketIndex(buckets, new Date(row.created_at));
      if (index === -1) continue;
      if (row.event_type === "page_view") points[index].pageViews += 1;
      else if (row.event_type === "phone_click") points[index].phoneClicks += 1;
      else if (row.event_type === "kakao_click") points[index].kakaoClicks += 1;
    }

    const consultationRows =
      (consultationsRes.data as { created_at: string }[] | null) ?? [];

    for (const row of consultationRows) {
      const index = findBucketIndex(buckets, new Date(row.created_at));
      if (index === -1) continue;
      points[index].consultations += 1;
    }

    return { data: points, error: null };
  } catch (err) {
    console.error("[analytics] client error:", err);
    return { data: [], error: "통계 데이터를 불러오지 못했습니다." };
  }
}

export interface GetLandingPagePerformanceResult {
  data: LandingPagePerformanceRow[];
  error: string | null;
}

const DELETED_LANDING_PAGE_KEY = "__deleted__";

interface PerformanceAccumulator {
  pageViews: number;
  phoneClicks: number;
  kakaoClicks: number;
  consultations: number;
}

function emptyAccumulator(): PerformanceAccumulator {
  return { pageViews: 0, phoneClicks: 0, kakaoClicks: 0, consultations: 0 };
}

/**
 * 랜딩페이지별 성과 표. 선택한 기간 내 이벤트/상담 행을 landing_page_id별로
 * 집계한 뒤 landing_pages 정보(업체명/slug)와 합친다. 삭제된 랜딩페이지의
 * 과거 데이터는 "삭제된 랜딩페이지" 한 행으로 합쳐 표시한다.
 */
export async function getLandingPagePerformance(
  period: AnalyticsPeriod
): Promise<GetLandingPagePerformanceResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { start, end } = getAnalyticsPeriodRange(period);

    const [eventsRes, consultationsRes, landingPagesRes] = await Promise.all([
      supabase
        .from("landing_page_events")
        .select("landing_page_id, event_type")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .limit(ANALYTICS_MAX_ROWS),
      supabase
        .from("consultation_requests")
        .select("landing_page_id")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .limit(ANALYTICS_MAX_ROWS),
      supabase.from("landing_pages").select("id, business_name, slug"),
    ]);

    const firstError = eventsRes.error ?? consultationsRes.error ?? landingPagesRes.error;
    if (firstError) {
      console.error("[analytics] performance error:", firstError);
      return { data: [], error: "통계 데이터를 불러오지 못했습니다." };
    }

    const byLandingPage = new Map<string, PerformanceAccumulator>();

    const eventRows =
      (eventsRes.data as
        | { landing_page_id: string | null; event_type: LandingPageEventType }[]
        | null) ?? [];

    for (const row of eventRows) {
      const key = row.landing_page_id ?? DELETED_LANDING_PAGE_KEY;
      const acc = byLandingPage.get(key) ?? emptyAccumulator();
      if (row.event_type === "page_view") acc.pageViews += 1;
      else if (row.event_type === "phone_click") acc.phoneClicks += 1;
      else if (row.event_type === "kakao_click") acc.kakaoClicks += 1;
      byLandingPage.set(key, acc);
    }

    const consultationRows =
      (consultationsRes.data as { landing_page_id: string | null }[] | null) ?? [];

    for (const row of consultationRows) {
      const key = row.landing_page_id ?? DELETED_LANDING_PAGE_KEY;
      const acc = byLandingPage.get(key) ?? emptyAccumulator();
      acc.consultations += 1;
      byLandingPage.set(key, acc);
    }

    const landingPageInfoById = new Map(
      (
        (landingPagesRes.data as
          | { id: string; business_name: string; slug: string }[]
          | null) ?? []
      ).map((lp) => [lp.id, lp] as const)
    );

    const rows: LandingPagePerformanceRow[] = [];
    for (const [key, acc] of byLandingPage.entries()) {
      if (key === DELETED_LANDING_PAGE_KEY) {
        rows.push({
          landingPageId: null,
          businessName: "삭제된 랜딩페이지",
          slug: null,
          ...acc,
        });
        continue;
      }

      const info = landingPageInfoById.get(key);
      rows.push({
        landingPageId: key,
        businessName: info?.business_name ?? "삭제된 랜딩페이지",
        slug: info?.slug ?? null,
        ...acc,
      });
    }

    rows.sort((a, b) => b.pageViews - a.pageViews);

    return { data: rows, error: null };
  } catch (err) {
    console.error("[analytics] client error:", err);
    return { data: [], error: "통계 데이터를 불러오지 못했습니다." };
  }
}

export interface RecordLandingPageEventResult {
  success: boolean;
}

/**
 * 이벤트 1건을 저장한다. 호출부(app/api/analytics/route.ts)가 이미
 * eventType allowlist 검증과 "이 landing_page가 실제로 public인지" 확인을
 * 마쳤다고 가정한다.
 */
export async function recordLandingPageEvent(
  landingPageId: string,
  eventType: LandingPageEventType
): Promise<RecordLandingPageEventResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.from("landing_page_events").insert({
      landing_page_id: landingPageId,
      event_type: eventType,
    });

    if (error) {
      console.error("[landing_page_events] insert error:", error);
      return { success: false };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_page_events] client error:", err);
    return { success: false };
  }
}
