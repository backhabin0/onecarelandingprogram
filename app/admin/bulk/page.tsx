import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import BulkUploadPanel from "@/components/admin/BulkUploadPanel";
import { getSimilarityThresholds } from "@/lib/bulk-publish-settings";

// 유사도 기준값을 항상 최신 설정으로 보여준다.
export const dynamic = "force-dynamic";

export default async function AdminBulkUploadPage() {
  const { thresholds, error } = await getSimilarityThresholds();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="대량 등록"
        description="엑셀 파일로 여러 랜딩페이지를 한 번에 검사하고 공개 대기열에 넣습니다."
        action={
          <Link
            href="/admin/queue"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            공개 대기열 보기 →
          </Link>
        }
      />

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">검사 기준</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>새 페이지 만들기와 같은 규칙(필수값, 글자 수, URL 형식, 예약어, 카카오 URL)으로 검사합니다.</li>
          <li>
            URL Slug는 <span className="font-mono">region_slug-keyword_slug</span>로 만들어집니다.
            이미 사용 중인 URL이나 대기열에 있는 지역·키워드는 오류입니다.
          </li>
          <li>템플릿 칸이 비어 있으면 template-a를 씁니다.</li>
          <li>
            대표 문구+소개 문구를 같은 키워드의 기존 페이지·대기열·파일 안 앞쪽 행과 비교해 유사도가{" "}
            {Math.round(thresholds.warning * 100)}% 이상이면 경고,{" "}
            {Math.round(thresholds.error * 100)}% 이상이면 오류로 표시합니다.{" "}
            <Link href="/admin/settings" className="text-blue-600 hover:text-blue-700">
              기준 바꾸기
            </Link>
          </li>
        </ul>
        {error ? <p className="mt-2 text-xs text-amber-700">{error}</p> : null}
      </Card>

      <BulkUploadPanel />
    </div>
  );
}
