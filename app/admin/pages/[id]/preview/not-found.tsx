import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";

export default function PreviewLandingPageNotFound() {
  return (
    <div>
      <PageHeader title="랜딩페이지 미리보기" />
      <Card className="p-6">
        <p className="text-sm text-slate-600">
          미리볼 랜딩페이지를 찾을 수 없습니다. 삭제되었거나 잘못된 주소일 수
          있습니다.
        </p>
        <Link
          href="/admin/pages"
          className="mt-4 inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          목록으로 돌아가기
        </Link>
      </Card>
    </div>
  );
}
