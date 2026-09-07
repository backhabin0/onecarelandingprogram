"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CONSULTATION_STATUS_OPTIONS } from "@/lib/consultation-status";
import type { ConsultationRequestSort } from "@/types/consultation-request";

interface LandingPageOption {
  id: string;
  business_name: string;
  slug: string;
}

interface ConsultationFiltersProps {
  landingPages: LandingPageOption[];
  currentSearch: string;
  currentStatus: string;
  currentLandingPageId: string;
  currentSort: ConsultationRequestSort;
}

const selectClassName =
  "rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export default function ConsultationFilters({
  landingPages,
  currentSearch,
  currentStatus,
  currentLandingPageId,
  currentSort,
}: ConsultationFiltersProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(currentSearch);

  const navigate = (
    overrides: Partial<{
      search: string;
      status: string;
      landingPageId: string;
      sort: string;
    }>
  ) => {
    const next = {
      search: currentSearch,
      status: currentStatus,
      landingPageId: currentLandingPageId,
      sort: currentSort,
      ...overrides,
    };

    const params = new URLSearchParams();
    if (next.search) params.set("search", next.search);
    if (next.status !== "all") params.set("status", next.status);
    if (next.landingPageId !== "all") params.set("landingPageId", next.landingPageId);
    if (next.sort !== "newest") params.set("sort", next.sort);
    // 필터가 바뀌면 항상 1페이지부터 다시 보여준다.

    const query = params.toString();
    router.push(`/admin/consultations${query ? `?${query}` : ""}`);
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ search: searchInput.trim() });
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <form
        onSubmit={handleSearchSubmit}
        className="flex min-w-[220px] flex-1 items-end gap-2"
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <label
            htmlFor="consultation-search"
            className="text-sm font-medium text-slate-700"
          >
            이름 / 연락처 검색
          </label>
          <input
            id="consultation-search"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="예: 홍길동 또는 010"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          검색
        </button>
      </form>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="consultation-status"
          className="text-sm font-medium text-slate-700"
        >
          상태
        </label>
        <select
          id="consultation-status"
          className={selectClassName}
          value={currentStatus}
          onChange={(e) => navigate({ status: e.target.value })}
        >
          <option value="all">전체</option>
          {CONSULTATION_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="consultation-landing-page"
          className="text-sm font-medium text-slate-700"
        >
          랜딩페이지
        </label>
        <select
          id="consultation-landing-page"
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

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="consultation-sort"
          className="text-sm font-medium text-slate-700"
        >
          정렬
        </label>
        <select
          id="consultation-sort"
          className={selectClassName}
          value={currentSort}
          onChange={(e) => navigate({ sort: e.target.value })}
        >
          <option value="newest">최신순</option>
          <option value="oldest">오래된순</option>
        </select>
      </div>
    </div>
  );
}
