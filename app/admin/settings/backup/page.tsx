import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import BackupRestorePanel from "@/components/admin/BackupRestorePanel";
import { getCurrentDataCounts } from "@/lib/backup/export";

// 백업 다운로드/복구 화면은 항상 최신 데이터 현황을 보여줘야 한다.
export const dynamic = "force-dynamic";

export default async function AdminBackupPage() {
  const { data: counts, error } = await getCurrentDataCounts();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="백업 및 복구"
        description="관리자 실수나 데이터 손상에 대비해 데이터를 내려받고, 필요할 때 안전하게 복구할 수 있습니다."
        action={
          <Link
            href="/admin/settings"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            ← 설정으로 돌아가기
          </Link>
        }
      />

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">현재 데이터 현황</h2>
        {error ? (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <dt className="text-xs text-slate-500">랜딩페이지</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {counts.landingPages.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">SEO 설정</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {counts.seoSettings.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">FAQ</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {counts.faqs.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">상담</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {counts.consultations.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">통계 이벤트</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {counts.events.toLocaleString()}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <BackupRestorePanel />
    </div>
  );
}
