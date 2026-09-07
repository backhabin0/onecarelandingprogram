"use client";

import { useRouter } from "next/navigation";
import type { AnalyticsPeriod } from "@/types/analytics";

interface LandingPageOption {
  id: string;
  business_name: string;
  slug: string;
}

interface AnalyticsFiltersBarProps {
  landingPages: LandingPageOption[];
  currentPeriod: AnalyticsPeriod;
  currentLandingPageId: string;
}

const selectClassName =
  "rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "day", label: "오늘" },
  { value: "week", label: "이번 주" },
  { value: "month", label: "이번 달" },
];

export default function AnalyticsFiltersBar({
  landingPages,
  currentPeriod,
  currentLandingPageId,
}: AnalyticsFiltersBarProps) {
  const router = useRouter();

  const navigate = (
    overrides: Partial<{ period: string; landingPageId: string }>
  ) => {
    const next = {
      period: currentPeriod,
      landingPageId: currentLandingPageId,
      ...overrides,
    };

    const params = new URLSearchParams();
    if (next.period !== "month") params.set("period", next.period);
    if (next.landingPageId !== "all") params.set("landingPageId", next.landingPageId);

    const query = params.toString();
    router.push(`/admin/analytics${query ? `?${query}` : ""}`);
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="analytics-period" className="text-sm font-medium text-slate-700">
          기간
        </label>
        <select
          id="analytics-period"
          className={selectClassName}
          value={currentPeriod}
          onChange={(e) => navigate({ period: e.target.value })}
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="analytics-landing-page"
          className="text-sm font-medium text-slate-700"
        >
          랜딩페이지
        </label>
        <select
          id="analytics-landing-page"
          className={selectClassName}
          value={currentLandingPageId}
          onChange={(e) => navigate({ landingPageId: e.target.value })}
        >
          <option value="all">전체 랜딩페이지</option>
          {landingPages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.business_name} (/{page.slug})
            </option>
          ))}
          <option value="deleted">삭제된 랜딩페이지</option>
        </select>
      </div>
    </div>
  );
}
