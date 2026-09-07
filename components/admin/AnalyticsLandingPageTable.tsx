import type { LandingPagePerformanceRow } from "@/types/analytics";

interface AnalyticsLandingPageTableProps {
  rows: LandingPagePerformanceRow[];
}

export default function AnalyticsLandingPageTable({
  rows,
}: AnalyticsLandingPageTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-400">아직 수집된 통계가 없습니다.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="px-3 py-2 font-medium">랜딩페이지</th>
            <th className="px-3 py-2 font-medium">조회수</th>
            <th className="px-3 py-2 font-medium">전화 클릭</th>
            <th className="px-3 py-2 font-medium">카카오 클릭</th>
            <th className="px-3 py-2 font-medium">상담 신청</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.landingPageId ?? "deleted"}
              className="border-b border-slate-100 text-slate-700 last:border-0"
            >
              <td className="px-3 py-2">
                <p className="font-medium text-slate-900">{row.businessName}</p>
                {row.slug ? (
                  <p className="text-xs text-slate-400">/{row.slug}</p>
                ) : null}
              </td>
              <td className="px-3 py-2">{row.pageViews}</td>
              <td className="px-3 py-2">{row.phoneClicks}</td>
              <td className="px-3 py-2">{row.kakaoClicks}</td>
              <td className="px-3 py-2">{row.consultations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
