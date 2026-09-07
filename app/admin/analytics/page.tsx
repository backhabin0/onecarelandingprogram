import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import AnalyticsFiltersBar from "@/components/admin/AnalyticsFiltersBar";
import AnalyticsSummaryCards from "@/components/admin/AnalyticsSummaryCards";
import AnalyticsTimeSeriesChart from "@/components/admin/AnalyticsTimeSeriesChart";
import AnalyticsLandingPageTable from "@/components/admin/AnalyticsLandingPageTable";
import {
  getAnalyticsSummary,
  getAnalyticsTimeSeries,
  getLandingPagePerformance,
} from "@/lib/analytics";
import { getLandingPages } from "@/lib/landing-pages";
import type { AnalyticsPeriod } from "@/types/analytics";

// 통계는 항상 최신 DB 상태를 조회해야 하므로 정적 프리렌더링을 사용하지 않는다.
export const dynamic = "force-dynamic";

function isAnalyticsPeriod(value: string): value is AnalyticsPeriod {
  return value === "day" || value === "week" || value === "month";
}

interface AdminAnalyticsPageProps {
  searchParams: Promise<{ period?: string; landingPageId?: string }>;
}

export default async function AdminAnalyticsPage({
  searchParams,
}: AdminAnalyticsPageProps) {
  const params = await searchParams;

  const period: AnalyticsPeriod =
    params.period && isAnalyticsPeriod(params.period) ? params.period : "month";
  const landingPageId = params.landingPageId || "all";

  const [
    { data: summary, error: summaryError },
    { data: timeSeries, error: timeSeriesError },
    { data: performance, error: performanceError },
    { data: landingPages },
  ] = await Promise.all([
    getAnalyticsSummary({ period, landingPageId }),
    getAnalyticsTimeSeries({ period, landingPageId }),
    getLandingPagePerformance(period),
    getLandingPages(),
  ]);

  const error = summaryError || timeSeriesError || performanceError;

  return (
    <div>
      <PageHeader
        title="통계"
        description="랜딩페이지 조회수와 상담 전환 성과를 확인합니다."
      />

      <Card className="p-4">
        <AnalyticsFiltersBar
          landingPages={landingPages.map((lp) => ({
            id: lp.id,
            business_name: lp.business_name,
            slug: lp.slug,
          }))}
          currentPeriod={period}
          currentLandingPageId={landingPageId}
        />
      </Card>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <>
          <div className="mt-4">
            <AnalyticsSummaryCards summary={summary} />
          </div>

          <Card className="mt-4 p-6">
            <h2 className="text-base font-semibold text-slate-900">
              기간별 추이
            </h2>
            <div className="mt-4">
              <AnalyticsTimeSeriesChart points={timeSeries} />
            </div>
          </Card>

          <Card className="mt-4 p-6">
            <h2 className="text-base font-semibold text-slate-900">
              랜딩페이지별 성과
            </h2>
            <div className="mt-4">
              <AnalyticsLandingPageTable rows={performance} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
