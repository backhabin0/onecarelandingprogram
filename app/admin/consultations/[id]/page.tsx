import { notFound } from "next/navigation";
import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import ConsultationStatusControl from "@/components/admin/ConsultationStatusControl";
import { getConsultationRequestById } from "@/lib/consultation-requests";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ConsultationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ConsultationDetailPage({
  params,
}: ConsultationDetailPageProps) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const { data: consultation, error } = await getConsultationRequestById(id);

  if (error || !consultation) {
    notFound();
  }

  const phoneHref = `tel:${consultation.phone.replace(/[^\d+]/g, "")}`;

  return (
    <div>
      <PageHeader
        title="상담 상세"
        description={`접수일: ${formatDate(consultation.created_at)}`}
        action={
          <Link
            href="/admin/consultations"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            ← 목록으로
          </Link>
        }
      />

      <Card className="p-6">
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-slate-500">상담 ID</dt>
            <dd className="mt-1 break-all text-xs text-slate-500">
              {consultation.id}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">접수일</dt>
            <dd className="mt-1 text-slate-900">
              {formatDate(consultation.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">업체명</dt>
            <dd className="mt-1 text-slate-900">
              {consultation.landing_page?.business_name ?? "삭제된 랜딩페이지"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">
              랜딩페이지 URL
            </dt>
            <dd className="mt-1 text-slate-900">
              {consultation.landing_page
                ? `/${consultation.landing_page.slug}`
                : "-"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">이름</dt>
            <dd className="mt-1 text-slate-900">{consultation.name}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">연락처</dt>
            <dd className="mt-1 flex items-center gap-3 text-slate-900">
              {consultation.phone}
              <a
                href={phoneHref}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                전화하기
              </a>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm font-medium text-slate-500">문의내용</dt>
            <dd className="mt-1 whitespace-pre-line text-slate-900">
              {consultation.message || "-"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500">
              개인정보 수집 동의
            </dt>
            <dd className="mt-1 text-slate-900">
              {consultation.privacy_consent ? "동의함" : "동의하지 않음"}
            </dd>
          </div>
        </dl>

        <div className="mt-8 border-t border-slate-100 pt-6">
          <p className="text-sm font-medium text-slate-500">상태</p>
          <div className="mt-2">
            <ConsultationStatusControl
              id={consultation.id}
              status={consultation.status}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
