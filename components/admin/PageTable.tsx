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
import PageCopyFilter from "@/components/admin/PageCopyFilter";
import type { LandingPageCopyFilter } from "@/lib/landing-pages";
import { checkedCountWithOverrides, copyThenCheck } from "@/lib/copy-check";
import {
  deleteLandingPageAction,
  getLandingPageRenameTargetsAction,
  renameLandingPagesAction,
  toggleLandingPageStatusAction,
} from "@/app/admin/pages/actions";
import { setSearchSubmissionCheckAction } from "@/app/admin/queue/actions";

/** URL 복사 완료 체크(search_submission_checks — 공개 대기열 '공개된 주소' 카드와 같은 기록) */
export interface PageCopyCheckProps {
  filter: LandingPageCopyFilter;
  /** 이 화면의 공개 페이지 중 체크된 id */
  checkedIds: string[];
  /** 검색 조건에 맞는 공개 페이지 중 체크된 수 */
  checkedCount: number;
  /** 검색 조건에 맞는 공개 페이지 수 */
  publicCount: number;
  /** 체크 상태를 불러오지 못했을 때 안내 */
  error: string | null;
}

interface PageTableProps {
  pages: LandingPage[];
  /** 지금 검색어(검색 결과 전체 선택에 씀) */
  search?: string;
  /** 검색 결과 전체 건수 */
  totalCount?: number;
  /** 홈 대표 업체명(업체명 일괄 변경 안내) */
  siteBusinessName?: string | null;
  /** 없으면 복사완료 칸·필터를 보여주지 않는다 */
  copyCheck?: PageCopyCheckProps;
}

const COPY_SAVE_ERROR = "복사 완료 표시를 저장하지 못했습니다. 다시 시도해주세요.";

const COLUMNS = ["", "업체명", "URL", "템플릿", "상태", "작성일", "관리"];

function nextStatus(status: LandingPageStatus): LandingPageStatus {
  return status === "public" ? "private" : "public";
}

export default function PageTable({
  pages,
  search = "",
  totalCount = pages.length,
  siteBusinessName = null,
  copyCheck,
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
  // 복사완료 체크: 서버에서 받은 값 위에 방금 바꾼(저장 중인) 값을 덮어 보여 준다.
  // 필터 화면에서 체크를 바꿔도 줄이 바로 사라지지 않도록 목록을 새로 불러오지 않는다.
  const [serverChecked] = useState(() => new Set(copyCheck?.checkedIds ?? []));
  const [checkOverrides, setCheckOverrides] = useState<Record<string, boolean>>({});
  const [checkPending, setCheckPending] = useState<Set<string>>(new Set());
  const [checkSaveError, setCheckSaveError] = useState<string | null>(null);

  const isRowPending = (id: string) => isPending && pendingId === id;

  const isCopyChecked = (id: string) => checkOverrides[id] ?? serverChecked.has(id);
  // 체크 상태를 불러오지 못했으면 틀린 체크를 보여주지 않도록 체크칸을 숨긴다.
  const showCopyCheck = Boolean(copyCheck) && !copyCheck?.error;
  // 숫자도 방금 바꾼 체크만큼 바로 반영한다.
  const copyCheckedCount = checkedCountWithOverrides(copyCheck?.checkedCount ?? 0, serverChecked, checkOverrides);

  const saveCopyChecked = async (page: LandingPage, checked: boolean) => {
    if (checkPending.has(page.id)) return;
    const previous = isCopyChecked(page.id);
    setCheckSaveError(null);
    setCheckOverrides((current) => ({ ...current, [page.id]: checked }));
    setCheckPending((current) => new Set(current).add(page.id));

    let failure: string | null = null;
    try {
      const result = await setSearchSubmissionCheckAction(page.id, checked);
      if (!result.success) failure = result.error ?? COPY_SAVE_ERROR;
    } catch {
      failure = COPY_SAVE_ERROR;
    }

    if (failure) {
      // 저장하지 못했으면 화면의 체크를 원래대로 되돌린다.
      setCheckOverrides((current) => ({ ...current, [page.id]: previous }));
      setCheckSaveError(failure);
    }
    setCheckPending((current) => {
      const next = new Set(current);
      next.delete(page.id);
      return next;
    });
  };

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
    await copyThenCheck({
      copy: () => navigator.clipboard.writeText(getAbsoluteUrl(`/${page.slug}`)),
      onCopied: () => {
        setCopiedId(page.id);
        setTimeout(() => {
          setCopiedId((current) => (current === page.id ? null : current));
        }, 2000);
      },
      needsCheck: showCopyCheck && !isCopyChecked(page.id),
      check: () => saveCopyChecked(page, true),
    });
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
      {copyCheck ? (
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PageCopyFilter current={copyCheck.filter} search={search} />
            {copyCheck.error ? null : (
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{copyCheckedCount.toLocaleString("ko-KR")}</span>
                {" / "}
                {copyCheck.publicCount.toLocaleString("ko-KR")} 복사완료
              </p>
            )}
          </div>
          {copyCheck.error ? <p className="mt-2 text-sm text-amber-700">{copyCheck.error}</p> : null}
          {checkSaveError ? <p className="mt-2 text-sm text-red-600">{checkSaveError}</p> : null}
        </div>
      ) : null}
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
                    {showCopyCheck && page.status === "public" ? (
                      <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          aria-label={`${page.business_name} 복사완료`}
                          checked={isCopyChecked(page.id)}
                          disabled={checkPending.has(page.id)}
                          onChange={(e) => saveCopyChecked(page, e.target.checked)}
                        />
                        복사완료
                      </label>
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
        ) : pages.length === 0 && copyCheck && copyCheck.filter !== "all" ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            {copyCheck.filter === "done" ? "복사완료한 페이지가 없습니다." : "복사 안 한 공개 페이지가 없습니다."}
          </p>
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
