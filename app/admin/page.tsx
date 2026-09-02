import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import { getLandingPages } from "@/lib/landing-pages";
import { mockTemplates } from "@/lib/mock-data";

// 대시보드 통계는 항상 최신 DB 상태를 조회해야 하므로 정적 프리렌더링을 사용하지 않는다.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const { data: pages, error } = await getLandingPages();

  const publishedCount = pages.filter((page) => page.status === "public").length;
  const draftCount = pages.filter((page) => page.status === "private").length;

  const stats = [
    { label: "전체 랜딩페이지", value: pages.length },
    { label: "공개 중", value: publishedCount },
    { label: "비공개", value: draftCount },
    { label: "등록된 템플릿", value: mockTemplates.length },
  ];

  return (
    <div>
      <PageHeader
        title="대시보드"
        description="랜딩페이지 자동 생성 및 배포 현황을 확인하세요."
      />

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <p className="text-sm text-slate-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {stat.value}
            </p>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-base font-semibold text-slate-900">빠른 작업</h2>
        <p className="mt-1 text-sm text-slate-500">
          새 랜딩페이지를 만들거나 기존 페이지 목록을 확인할 수 있습니다.
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            href="/admin/pages/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + 새 랜딩페이지 만들기
          </Link>
          <Link
            href="/admin/pages"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            랜딩페이지 목록 보기
          </Link>
        </div>
      </Card>
    </div>
  );
}
