import PageHeader from "@/components/admin/PageHeader";
import Pagination from "@/components/admin/Pagination";
import MediaLibraryPanel from "@/components/admin/MediaLibraryPanel";
import { MEDIA_PAGE_SIZE, getMediaUsage, getUsedImageUrlCounts, listMediaAssets } from "@/lib/media-assets";
import { formatBytes, isMediaKind, type MediaKind } from "@/lib/media/library";

// 올리기·삭제가 바로 보여야 하므로 항상 최신 목록을 조회한다.
export const dynamic = "force-dynamic";

interface AdminMediaPageProps {
  searchParams: Promise<{ search?: string; kind?: string; page?: string }>;
}

export default async function AdminMediaPage({ searchParams }: AdminMediaPageProps) {
  const params = await searchParams;
  const search = params.search?.trim() || "";
  const kind: MediaKind | "all" = isMediaKind(params.kind) ? params.kind : "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [{ data: items, count, error }, usage, used] = await Promise.all([
    listMediaAssets({ search, kind, page }),
    getMediaUsage(),
    getUsedImageUrlCounts(),
  ]);

  const totalPages = Math.max(1, Math.ceil(count / MEDIA_PAGE_SIZE));
  const baseParams: Record<string, string> = {};
  if (search) baseParams.search = search;
  if (kind !== "all") baseParams.kind = kind;

  return (
    <div>
      <PageHeader
        title="사진 보관함"
        description={
          usage.error
            ? "사진과 로고를 한 번 올려 두고 여러 페이지에서 골라 씁니다."
            : `사진과 로고를 한 번 올려 두고 여러 페이지에서 골라 씁니다. 지금 ${usage.count.toLocaleString("ko-KR")}장 · ${formatBytes(usage.bytes)}`
        }
      />
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      <MediaLibraryPanel
        items={items}
        usedCounts={Object.fromEntries(used.data)}
        usageError={used.error}
        search={search}
        kind={kind}
      />
      {totalPages > 1 ? (
        <div className="mt-4">
          <Pagination page={page} totalPages={totalPages} baseParams={baseParams} basePath="/admin/media" />
        </div>
      ) : null}
    </div>
  );
}
