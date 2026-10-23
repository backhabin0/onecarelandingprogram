import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/admin/PageHeader";
import QueueItemForm from "@/components/admin/QueueItemForm";
import QueueStateBadge from "@/components/admin/QueueStateBadge";
import { isUuid } from "@/lib/bulk-upload/payload";
import { getQueueItem, queueRowToValues } from "@/lib/publish-queue";

export const dynamic = "force-dynamic";

interface EditQueueItemPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditQueueItemPage({ params }: EditQueueItemPageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data: item, error } = await getQueueItem(id);
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
    );
  }
  if (!item) notFound();

  return (
    <div>
      <PageHeader
        title="대기열 항목 수정"
        description={`${item.region} · ${item.keyword} — AI 대량 생성과 같은 규칙으로 다시 검사한 뒤 저장합니다.`}
        action={
          <Link href="/admin/queue" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            ← 공개 대기열로 돌아가기
          </Link>
        }
      />
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-600">
        현재 상태 <QueueStateBadge state={item.state} />
      </div>
      {item.state === "published" ? (
        <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          이미 공개된 항목은 여기서 수정할 수 없습니다.{" "}
          {item.landing_page_id ? (
            <Link href={`/admin/pages/${item.landing_page_id}/edit`} className="text-blue-600 hover:text-blue-700">
              랜딩페이지 수정 화면으로 이동
            </Link>
          ) : null}
        </p>
      ) : (
        <QueueItemForm id={item.id} initialValues={queueRowToValues(item)} currentState={item.state} />
      )}
    </div>
  );
}
