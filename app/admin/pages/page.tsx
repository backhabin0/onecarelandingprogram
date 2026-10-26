import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import PageTable from "@/components/admin/PageTable";
import Pagination from "@/components/admin/Pagination";
import PageSearchForm from "@/components/admin/PageSearchForm";
import { LANDING_PAGES_PAGE_SIZE, getLandingPagesPage } from "@/lib/landing-pages";
import { getSiteProfile } from "@/lib/site-profile";

// 관리자 목록은 항상 최신 DB 상태를 조회해야 하므로 정적 프리렌더링을 사용하지 않는다.
export const dynamic = "force-dynamic";

interface AdminPagesPageProps {
  searchParams: Promise<{ page?: string; search?: string }>;
}

export default async function AdminPagesPage({ searchParams }: AdminPagesPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const search = params.search?.trim() || "";

  const [{ data: pages, count, error }, siteProfile] = await Promise.all([
    getLandingPagesPage(page, search),
    getSiteProfile(),
  ]);

  const totalPages = Math.max(1, Math.ceil(count / LANDING_PAGES_PAGE_SIZE));
  const baseParams: Record<string, string> = search ? { search } : {};

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
        <PageSearchForm currentSearch={search} />
      </Card>

      <Card>
        <PageTable
          key={`${search}|${page}`}
          pages={pages}
          search={search}
          totalCount={count}
          siteBusinessName={siteProfile.businessName}
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
