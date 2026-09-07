import Link from "next/link";

interface PaginationProps {
  page: number;
  totalPages: number;
  /** page를 제외한 현재 검색/필터/정렬 조건 (URLSearchParams용) */
  baseParams: Record<string, string>;
}

const linkClassName =
  "rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50";
const disabledClassName =
  "cursor-not-allowed rounded-md border border-slate-100 px-3 py-1.5 text-slate-300";

export default function Pagination({ page, totalPages, baseParams }: PaginationProps) {
  const buildHref = (targetPage: number) => {
    const params = new URLSearchParams(baseParams);
    if (targetPage > 1) {
      params.set("page", String(targetPage));
    }
    const query = params.toString();
    return `/admin/consultations${query ? `?${query}` : ""}`;
  };

  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        {page} / {totalPages} 페이지
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className={linkClassName}>
            이전
          </Link>
        ) : (
          <span className={disabledClassName}>이전</span>
        )}
        {page < totalPages ? (
          <Link href={buildHref(page + 1)} className={linkClassName}>
            다음
          </Link>
        ) : (
          <span className={disabledClassName}>다음</span>
        )}
      </div>
    </div>
  );
}
