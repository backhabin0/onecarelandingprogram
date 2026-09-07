import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import ConsultationFilters from "@/components/admin/ConsultationFilters";
import ConsultationTable from "@/components/admin/ConsultationTable";
import Pagination from "@/components/admin/Pagination";
import {
  CONSULTATION_REQUESTS_PAGE_SIZE,
  getConsultationRequests,
} from "@/lib/consultation-requests";
import { getLandingPages } from "@/lib/landing-pages";
import { isConsultationRequestStatus } from "@/lib/consultation-status";
import type { ConsultationRequestSort } from "@/types/consultation-request";

// 상담 목록은 항상 최신 DB 상태를 조회해야 하므로 정적 프리렌더링을 사용하지 않는다.
export const dynamic = "force-dynamic";

interface AdminConsultationsPageProps {
  searchParams: Promise<{
    search?: string;
    status?: string;
    landingPageId?: string;
    sort?: string;
    page?: string;
  }>;
}

export default async function AdminConsultationsPage({
  searchParams,
}: AdminConsultationsPageProps) {
  const params = await searchParams;

  const search = params.search?.trim() || "";
  const status =
    params.status && isConsultationRequestStatus(params.status)
      ? params.status
      : "all";
  const landingPageId = params.landingPageId || "all";
  const sort: ConsultationRequestSort =
    params.sort === "oldest" ? "oldest" : "newest";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [
    { data: consultations, count, error },
    { data: landingPages },
  ] = await Promise.all([
    getConsultationRequests({ search, status, landingPageId, sort, page }),
    getLandingPages(),
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(count / CONSULTATION_REQUESTS_PAGE_SIZE)
  );

  const baseParams: Record<string, string> = {};
  if (search) baseParams.search = search;
  if (status !== "all") baseParams.status = status;
  if (landingPageId !== "all") baseParams.landingPageId = landingPageId;
  if (sort !== "newest") baseParams.sort = sort;

  const exportQuery = new URLSearchParams(baseParams).toString();
  const exportHref = `/admin/consultations/export${exportQuery ? `?${exportQuery}` : ""}`;

  const isFiltered = Boolean(
    search || status !== "all" || landingPageId !== "all"
  );

  return (
    <div>
      <PageHeader
        title="상담 관리"
        description="고객이 접수한 상담 신청 내역을 확인하고 관리합니다."
        action={
          <a
            href={exportHref}
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            CSV 다운로드
          </a>
        }
      />

      <Card className="p-4">
        <ConsultationFilters
          landingPages={landingPages.map((lp) => ({
            id: lp.id,
            business_name: lp.business_name,
            slug: lp.slug,
          }))}
          currentSearch={search}
          currentStatus={status}
          currentLandingPageId={landingPageId}
          currentSort={sort}
        />
      </Card>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <Card className="mt-4">
          <ConsultationTable
            consultations={consultations}
            isFiltered={isFiltered}
          />
          {consultations.length > 0 ? (
            <Pagination page={page} totalPages={totalPages} baseParams={baseParams} />
          ) : null}
        </Card>
      )}
    </div>
  );
}
