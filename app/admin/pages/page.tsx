import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import PageTable from "@/components/admin/PageTable";
import Pagination from "@/components/admin/Pagination";
import PageSearchForm from "@/components/admin/PageSearchForm";
import {
  LANDING_PAGES_PAGE_SIZE,
  getLandingPageCopyCounts,
  getLandingPagesPage,
  isLandingPageCopyFilter,
  type LandingPageCopyFilter,
} from "@/lib/landing-pages";
import { getCheckedLandingPageIds } from "@/lib/search-submission-checks";
import { getSiteProfile } from "@/lib/site-profile";

// 관리자 목록은 항상 최신 DB 상태를 조회해야 하므로 정적 프리렌더링을 사용하지 않는다.
export const dynamic = "force-dynamic";

interface AdminPagesPageProps {
  searchParams: Promise<{ page?: string; search?: string; copy?: string }>;
}

export default async function AdminPagesPage({ searchParams }: AdminPagesPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const search = params.search?.trim() || "";
  const copyFilter: LandingPageCopyFilter =
    params.copy && isLandingPageCopyFilter(params.copy) ? params.copy : "all";

  const [{ data: pages, count, error }, copyCounts, siteProfile] = await Promise.all([
    getLandingPagesPage(page, search, copyFilter),
    getLandingPageCopyCounts(search),
    getSiteProfile(),
  ]);
  // 이 페이지에 보이는 공개 페이지의 URL 복사 체크(공개 대기열 '공개된 주소' 카드와 같은 기록)
  const checks = await getCheckedLandingPageIds(
    pages.filter((row) => row.status === "public").map((row) => row.id)
  );
  const checkError = copyCounts.error ?? (checks.error ? "복사 완료 표시를 불러오지 못했습니다." : null);

  const totalPages = Math.max(1, Math.ceil(count / LANDING_PAGES_PAGE_SIZE));
  const baseParams: Record<string, string> = {};
  if (search) baseParams.search = search;
  if (copyFilter !== "all") baseParams.copy = copyFilter;

  return (
    <div>
      <PageHeader
        title="랜딩페이지 관리"
        description="생성된 랜딩페이지 목록을 확인하고 관리합니다."
        action={
          <Link
            href="/admin/pages/new"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + 새 랜딩페이지 만들기
          </Link>
        }
      />

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Card className="mb-4 p-4">
        <PageSearchForm currentSearch={search} currentCopyFilter={copyFilter} />
      </Card>

      <Card>
        <PageTable
          key={`${search}|${copyFilter}|${page}`}
          pages={pages}
          search={search}
          totalCount={count}
          siteBusinessName={siteProfile.businessName}
          copyCheck={{
            filter: copyFilter,
            checkedIds: Array.from(checks.data),
            checkedCount: copyCounts.data.checked,
            publicCount: copyCounts.data.total,
            error: checkError,
          }}
        />
        {count > 0 ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            baseParams={baseParams}
            basePath="/admin/pages"
          />
        ) : null}
      </Card>
    </div>
  );
}
