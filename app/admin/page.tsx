import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import { getLandingPageCounts } from "@/lib/landing-pages";
import { mockTemplates } from "@/lib/mock-data";
import { scheduleAutoIndexNow } from "@/lib/indexnow-schedule";

// 대시보드 통계는 항상 최신 DB 상태를 조회해야 하므로 정적 프리렌더링을 사용하지 않는다.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  // 행 데이터를 가져와 세면 1,000행에서 잘리므로 DB count 쿼리로 집계한다.
  const { data: counts, error } = await getLandingPageCounts();

  // 관리자 화면 접속 시: 아직 검색엔진에 알리지 않은 공개 페이지가 있으면
  // 응답을 보낸 뒤(after) IndexNow로 보낸다. 실패해도 화면에는 영향 없음.
  await scheduleAutoIndexNow();

  const stats = [
    { label: "전체 랜딩페이지", value: counts.total },
    { label: "공개 중", value: counts.public },
    { label: "비공개", value: counts.private },
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
