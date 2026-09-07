import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";

export default function ConsultationDetailNotFound() {
  return (
    <div>
      <PageHeader title="상담 상세" />
      <Card className="p-6">
        <p className="text-sm text-slate-600">
          요청하신 상담 내역을 찾을 수 없습니다. 잘못된 주소일 수 있습니다.
        </p>
        <Link
          href="/admin/consultations"
          className="mt-4 inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          목록으로 돌아가기
        </Link>
      </Card>
    </div>
  );
}
