"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LandingPage, LandingPageStatus } from "@/types/landing-page";
import StatusBadge from "@/components/admin/StatusBadge";
import { getTemplateLabel } from "@/lib/mock-data";
import { formatDate } from "@/lib/format";
import {
  deleteLandingPageAction,
  toggleLandingPageStatusAction,
} from "@/app/admin/pages/actions";

interface PageTableProps {
  pages: LandingPage[];
}

const COLUMNS = ["업체명", "URL", "템플릿", "상태", "작성일", "관리"];

function nextStatus(status: LandingPageStatus): LandingPageStatus {
  return status === "public" ? "private" : "public";
}

export default function PageTable({ pages }: PageTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "status" | "delete" | null
  >(null);
  const [rowError, setRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  const isRowPending = (id: string) => isPending && pendingId === id;

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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {COLUMNS.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {column}
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
              <td className="px-4 py-3 font-medium text-slate-900">
                {page.business_name}
              </td>
              <td className="px-4 py-3 text-slate-500">
                {page.status === "public" ? (
                  <a
                    href={`/${page.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    /{page.slug}
                  </a>
                ) : (
                  <span>/{page.slug}</span>
                )}
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

      {pages.length === 0 ? (
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
  );
}
