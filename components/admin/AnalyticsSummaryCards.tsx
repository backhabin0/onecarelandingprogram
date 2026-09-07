import Card from "@/components/admin/Card";
import type { AnalyticsSummary } from "@/types/analytics";

interface AnalyticsSummaryCardsProps {
  summary: AnalyticsSummary;
}

export default function AnalyticsSummaryCards({
  summary,
}: AnalyticsSummaryCardsProps) {
  const conversionRate =
    summary.pageViews > 0
      ? (summary.consultations / summary.pageViews) * 100
      : null;

  const cards = [
    { label: "조회수", value: summary.pageViews },
    { label: "전화 클릭", value: summary.phoneClicks },
    { label: "카카오톡 클릭", value: summary.kakaoClicks },
    { label: "상담 신청", value: summary.consultations },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} className="p-5">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {card.value.toLocaleString()}
            </p>
          </Card>
        ))}
      </div>

      {conversionRate !== null ? (
        <Card className="p-5">
          <p className="text-sm text-slate-500">
            상담 전환율 (상담 신청 / 조회수)
          </p>
          <p className="mt-2 text-xl font-semibold text-slate-900">
            {conversionRate.toFixed(1)}%
          </p>
        </Card>
      ) : null}
    </div>
  );
}
