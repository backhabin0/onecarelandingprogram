"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LandingPage, LandingPageStatus } from "@/types/landing-page";
import StatusBadge from "@/components/admin/StatusBadge";
import BusinessNameRenameBar from "@/components/admin/BusinessNameRenameBar";
import SelectAllResultsNotice from "@/components/admin/SelectAllResultsNotice";
import type { RenameTarget } from "@/lib/business-name-rename";
import { getTemplateLabel } from "@/lib/mock-data";
import { formatDate } from "@/lib/format";
import { getAbsoluteUrl } from "@/lib/site";
import {
  deleteLandingPageAction,
  getLandingPageRenameTargetsAction,
  renameLandingPagesAction,
  toggleLandingPageStatusAction,
} from "@/app/admin/pages/actions";

interface PageTableProps {
  pages: LandingPage[];
  /** 지금 검색어(검색 결과 전체 선택에 씀) */
  search?: string;
  /** 검색 결과 전체 건수 */
  totalCount?: number;
  /** 홈 대표 업체명(업체명 일괄 변경 안내) */
  siteBusinessName?: string | null;
}

const COLUMNS = ["", "업체명", "URL", "템플릿", "상태", "작성일", "관리"];

function nextStatus(status: LandingPageStatus): LandingPageStatus {
  return status === "public" ? "private" : "public";
}

export default function PageTable({
  pages,
  search = "",
  totalCount = pages.length,
  siteBusinessName = null,
}: PageTableProps) {
  const router = useRouter();
  // 업체명 일괄 변경용 선택(id → 지금 업체명). "검색 결과 전체 선택"이면 다른 페이지 항목도 들어 있다.
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "status" | "delete" | null
  >(null);
  const [rowError, setRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isRowPending = (id: string) => isPending && pendingId === id;

  const allPageSelected = pages.length > 0 && pages.every((page) => selected.has(page.id));
  const selectedTargets: RenameTarget[] = Array.from(selected, ([id, businessName]) => ({ id, businessName }));

  const toggleSelected = (page: LandingPage) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(page.id)) next.delete(page.id);
      else next.set(page.id, page.business_name);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    setSelected(allPageSelected ? new Map() : new Map(pages.map((page) => [page.id, page.business_name])));
  };

  const selectAllResults = async () => {
    const { data, error } = await getLandingPageRenameTargetsAction(search);
    if (error) return error;
    setSelected(new Map(data.map((target) => [target.id, target.businessName])));
    return null;
  };

  const handleRenameDone = () => {
    setSelected(new Map());
    router.refresh();
  };

  const handleCopyUrl = async (page: LandingPage) => {
    try {
      await navigator.clipboard.writeText(getAbsoluteUrl(`/${page.slug}`));
      setCopiedId(page.id);
      setTimeout(() => {
        setCopiedId((current) => (current === page.id ? null : current));
      }, 2000);
    } catch (err) {
      console.error("[admin] URL 복사 실패:", err);
    }
  };

  const handleToggleStatus = (page: LandingPage) => {
    if (isPending) return;

    setRowError(null);
    setPendingId(page.id);
    setPendingAction("status");

    startTransition(async () => {
      const result = await toggleLandingPageStatusAction(
        page.id,
        nextStatus(page.status)
      );

      if (!result.success) {
        setRowError({
          id: page.id,
          message: result.error ?? "상태를 변경하지 못했습니다.",
        });
        setPendingId(null);
        setPendingAction(null);
        return;
      }

      router.refresh();
      setPendingId(null);
      setPendingAction(null);
    });
  };

  const handleDelete = (page: LandingPage) => {
    if (isPending) return;

    const confirmed = window.confirm(
      `${page.business_name} 랜딩페이지를 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.`
    );
    if (!confirmed) return;

    setRowError(null);
    setPendingId(page.id);
    setPendingAction("delete");

    startTransition(async () => {
      const result = await deleteLandingPageAction(page.id);

      if (!result.success) {
        setRowError({
          id: page.id,
          message: result.error ?? "랜딩페이지를 삭제하지 못했습니다.",
        });
        setPendingId(null);
        setPendingAction(null);
        return;
      }

      router.refresh();
      setPendingId(null);
      setPendingAction(null);
    });
  };

  return (
    <div>
      <SelectAllResultsNotice
        pageCount={pages.length}
        selectedCount={selected.size}
        allPageSelected={allPageSelected}
        totalCount={totalCount}
        selectAllLabel={`${search ? "검색 결과" : "전체 페이지"} ${totalCount.toLocaleString("ko-KR")}개 모두 선택`}
        onSelectAll={selectAllResults}
        onClear={() => setSelected(new Map())}
      />
      {selected.size > 0 ? (
        <BusinessNameRenameBar
          selected={selectedTargets}
          objectLabel="페이지를"
          rename={renameLandingPagesAction}
          onDone={handleRenameDone}
          siteBusinessName={siteBusinessName}
        />
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              {COLUMNS.map((column, i) => (
                <th key={column || i} className="px-4 py-3 font-medium">
                  {i === 0 ? (
                    <input
                      type="checkbox"
                      aria-label="이 페이지 전체 선택"
                      checked={allPageSelected}
                      onChange={toggleAllOnPage}
                      disabled={pages.length === 0}
                    />
                  ) : (
                    column
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr
                key={page.id}
                className="border-b border-slate-100 text-slate-700 last:border-0"
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`${page.business_name} 선택`}
                    checked={selected.has(page.id)}
                    onChange={() => toggleSelected(page)}
                  />
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {page.business_name}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  <div className="flex items-center gap-2">
                    {page.status === "public" ? (
                      <a
                        href={`/${page.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="max-w-[220px] truncate text-blue-600 hover:underline"
                        title={getAbsoluteUrl(`/${page.slug}`)}
                      >
                        {getAbsoluteUrl(`/${page.slug}`)}
                      </a>
                    ) : (
                      <span
                        className="max-w-[220px] truncate"
                        title={getAbsoluteUrl(`/${page.slug}`)}
                      >
                        {getAbsoluteUrl(`/${page.slug}`)}
                      </span>
                    )}
                    {page.status === "public" ? (
                      <button
                        type="button"
                        onClick={() => handleCopyUrl(page)}
                        className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        {copiedId === page.id ? "복사됨" : "URL 복사"}
                      </button>
                    ) : null}
                  </div>
                  {copiedId === page.id ? (
                    <p className="mt-1 text-xs text-emerald-600">
                      URL이 복사되었습니다.
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3">{getTemplateLabel(page.template)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={page.status} />
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(page)}
                      disabled={isPending}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isRowPending(page.id) && pendingAction === "status"
                        ? "변경 중..."
                        : page.status === "public"
                          ? "비공개로 전환"
                          : "공개로 전환"}
                    </button>
                  </div>
                  {rowError?.id === page.id ? (
                    <p className="mt-1 text-xs text-red-600">
                      {rowError.message}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {formatDate(page.created_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/pages/${page.id}/edit`}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      수정
                    </Link>
                    <Link
                      href={`/admin/pages/${page.id}/preview`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      미리보기
                    </Link>
                    <Link
                      href={`/admin/pages/${page.id}/duplicate`}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      복제
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(page)}
                      disabled={isPending}
                      className="rounded-md border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isRowPending(page.id) && pendingAction === "delete"
                        ? "삭제 중..."
                        : "삭제"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {pages.length === 0 && search ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">검색 결과가 없습니다.</p>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-slate-400">
            <p>등록된 랜딩페이지가 없습니다.</p>
            <Link
              href="/admin/pages/new"
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + 새 랜딩페이지 만들기
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
