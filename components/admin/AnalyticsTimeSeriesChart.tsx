import type { AnalyticsTimeSeriesPoint } from "@/types/analytics";

interface AnalyticsTimeSeriesChartProps {
  points: AnalyticsTimeSeriesPoint[];
}

export default function AnalyticsTimeSeriesChart({
  points,
}: AnalyticsTimeSeriesChartProps) {
  const hasData = points.some(
    (point) =>
      point.pageViews + point.phoneClicks + point.kakaoClicks + point.consultations > 0
  );

  if (!hasData) {
    return (
      <p className="text-sm text-slate-400">아직 수집된 통계가 없습니다.</p>
    );
  }

  const maxPageViews = Math.max(1, ...points.map((point) => point.pageViews));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-1 overflow-x-auto pb-2">
        {points.map((point) => (
          <div
            key={point.key}
            className="flex min-w-[28px] flex-1 flex-col items-center justify-end gap-1"
            style={{ height: "160px" }}
          >
            <div
              className="w-full rounded-t bg-blue-500"
              style={{
                height: `${Math.max(2, (point.pageViews / maxPageViews) * 140)}px`,
              }}
              title={`${point.label} 조회 ${point.pageViews}건`}
            />
            <span className="whitespace-nowrap text-[10px] text-slate-400">
              {point.label}
            </span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-3 py-2 font-medium">날짜</th>
              <th className="px-3 py-2 font-medium">조회</th>
              <th className="px-3 py-2 font-medium">전화</th>
              <th className="px-3 py-2 font-medium">카카오</th>
              <th className="px-3 py-2 font-medium">상담</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr
                key={point.key}
                className="border-b border-slate-100 text-slate-700 last:border-0"
              >
                <td className="whitespace-nowrap px-3 py-2">{point.label}</td>
                <td className="px-3 py-2">{point.pageViews}</td>
                <td className="px-3 py-2">{point.phoneClicks}</td>
                <td className="px-3 py-2">{point.kakaoClicks}</td>
                <td className="px-3 py-2">{point.consultations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
