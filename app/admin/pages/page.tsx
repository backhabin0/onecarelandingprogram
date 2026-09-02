import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import PageTable from "@/components/admin/PageTable";
import { getLandingPages } from "@/lib/landing-pages";

// 관리자 목록은 항상 최신 DB 상태를 조회해야 하므로 정적 프리렌더링을 사용하지 않는다.
export const dynamic = "force-dynamic";

export default async function AdminPagesPage() {
  const { data: pages, error } = await getLandingPages();

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

      <Card>
        <PageTable pages={pages} />
      </Card>
    </div>
  );
}
