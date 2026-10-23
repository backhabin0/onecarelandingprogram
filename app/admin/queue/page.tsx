import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
import Card from "@/components/admin/Card";
import Pagination from "@/components/admin/Pagination";
import QueueSearchForm from "@/components/admin/QueueSearchForm";
import QueueStateTabs from "@/components/admin/QueueStateTabs";
import QueueTable from "@/components/admin/QueueTable";
import {
  QUEUE_PAGE_SIZE,
  getQueuePage,
  getQueueStateCounts,
  isQueueStateFilter,
  type QueueStateFilter,
} from "@/lib/publish-queue";

// 대기열은 업로드·공개로 계속 바뀌므로 항상 최신 상태를 조회한다.
export const dynamic = "force-dynamic";

interface AdminQueuePageProps {
  searchParams: Promise<{ state?: string; search?: string; page?: string }>;
}

export default async function AdminQueuePage({ searchParams }: AdminQueuePageProps) {
  const params = await searchParams;
  const state: QueueStateFilter =
    params.state && isQueueStateFilter(params.state) ? params.state : "all";
  const search = params.search?.trim() || "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [{ data: items, count, error }, { data: counts, error: countsError }] = await Promise.all([
    getQueuePage({ state, search, page }),
    getQueueStateCounts(),
  ]);

  const totalPages = Math.max(1, Math.ceil(count / QUEUE_PAGE_SIZE));
  const baseParams: Record<string, string> = {};
  if (state !== "all") baseParams.state = state;
  if (search) baseParams.search = search;

  return (
    <div>
      <PageHeader
        title="공개 대기열"
        description="대량 등록으로 들어온 항목을 확인하고 관리합니다. 공개 대기(ready) 항목은 오래된 순으로 공개됩니다."
        action={
          <Link
            href="/admin/bulk"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            대량 등록
          </Link>
        }
      />

      <Card className="flex flex-col gap-4 p-4">
        <QueueStateTabs current={state} counts={counts} search={search} />
        <QueueSearchForm currentSearch={search} currentState={state} />
        {countsError ? <p className="text-xs text-red-600">{countsError}</p> : null}
      </Card>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <Card className="mt-4">
          <QueueTable items={items} isFiltered={Boolean(search || state !== "all")} />
          {count > 0 ? (
            <Pagination page={page} totalPages={totalPages} baseParams={baseParams} basePath="/admin/queue" />
          ) : null}
        </Card>
      )}
    </div>
  );
}
