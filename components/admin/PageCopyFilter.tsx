import Link from "next/link";
import type { LandingPageCopyFilter } from "@/lib/landing-pages";

const FILTERS: { value: LandingPageCopyFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "done", label: "복사완료" },
  { value: "todo", label: "안 한 것" },
];

interface PageCopyFilterProps {
  current: LandingPageCopyFilter;
  search: string;
}

/**
 * 랜딩페이지 목록 URL 복사 체크 필터(전체 / 복사완료 / 안 한 것).
 * 필터를 바꾸면 1페이지부터, 검색어는 유지한다. 복사완료·안 한 것은 공개 페이지만 보여 준다.
 */
export default function PageCopyFilter({ current, search }: PageCopyFilterProps) {
  const hrefFor = (filter: LandingPageCopyFilter) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filter !== "all") params.set("copy", filter);
    const query = params.toString();
    return `/admin/pages${query ? `?${query}` : ""}`;
  };

  return (
    <nav className="flex flex-wrap gap-1" aria-label="URL 복사">
      {FILTERS.map(({ value, label }) => {
        const active = value === current;
        return (
          <Link
            key={value}
            href={hrefFor(value)}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              active ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
