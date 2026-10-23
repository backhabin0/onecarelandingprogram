"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QueueStateBadge from "@/components/admin/QueueStateBadge";
import { deleteQueueItemsAction, releaseHeldItemsAction } from "@/app/admin/queue/actions";
import type { LandingPageQueueRow } from "@/types/publish-queue";

const COLUMNS = ["", "지역 · 키워드", "업체명 / 제목", "URL", "상태", "유사도", "확인 사항", "관리"];

interface QueueTableProps {
  items: LandingPageQueueRow[];
  isFiltered: boolean;
}

/** validation_errors에서 화면에 보여줄 문구만 꺼낸다(형식이 다르면 건너뜀) */
function issueMessages(item: LandingPageQueueRow): { text: string; level: "error" | "warning" }[] {
  const messages: { text: string; level: "error" | "warning" }[] = [];
  for (const issue of item.validation_errors) {
    if (typeof issue !== "object" || issue === null) continue;
    const { message, level } = issue as { message?: unknown; level?: unknown };
    if (typeof message !== "string") continue;
    // level이 없는 항목(공개 함수가 남긴 slug 충돌 등)은 오류로 본다.
    messages.push({ text: message, level: level === "warning" ? "warning" : "error" });
  }
  return messages;
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "";

export default function QueueTable({ items, isFiltered }: QueueTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  if (items.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-sm text-slate-500">
        {isFiltered ? "조건에 맞는 항목이 없습니다." : "대기열이 비어 있습니다. AI 대량 생성에서 엑셀 파일이나 표를 올려주세요."}
      </p>
    );
  }

  const selectable = items.filter((item) => item.state !== "published");
  const selectedItems = items.filter((item) => selected.has(item.id));
  const selectedHold = selectedItems.filter((item) => item.state === "hold");
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.id));

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectable.map((item) => item.id)));
  };

  const run = (
    ids: string[],
    action: (ids: string[]) => ReturnType<typeof releaseHeldItemsAction>,
    doneText: (n: number) => string
  ) => {
    if (isPending || ids.length === 0) return;
    setMessage(null);
    startTransition(async () => {
      const result = await action(ids);
      if (!result.success) {
        setMessage({ type: "error", text: result.error ?? "처리하지 못했습니다." });
        return;
      }
      setMessage({ type: "success", text: doneText(result.changed) });
      setSelected(new Set());
      router.refresh();
    });
  };

  const handleRelease = (ids: string[]) =>
    run(ids, releaseHeldItemsAction, (n) => `${n}개 항목을 공개 대기로 바꿨습니다.`);

  const handleDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      `선택한 ${ids.length}개 대기열 항목을 삭제하시겠습니까?\n삭제한 항목은 복구할 수 없습니다. (이미 공개된 페이지에는 영향 없음)`
    );
    if (!confirmed) return;
    run(ids, deleteQueueItemsAction, (n) => `${n}개 항목을 삭제했습니다.`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm">
        <span className="text-slate-500">선택 {selectedItems.length}개</span>
        <button
          type="button"
          onClick={() => handleRelease(selectedHold.map((item) => item.id))}
          disabled={isPending || selectedHold.length === 0}
          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          보류 → 공개 대기 ({selectedHold.length})
        </button>
        <button
          type="button"
          onClick={() => handleDelete(selectedItems.map((item) => item.id))}
          disabled={isPending || selectedItems.length === 0}
          className="rounded-md border border-red-200 px-3 py-1.5 font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          삭제 ({selectedItems.length})
        </button>
        {message ? (
          <span className={message.type === "error" ? "text-red-600" : "text-green-700"}>{message.text}</span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              {COLUMNS.map((column, i) => (
                <th key={column || i} className="px-4 py-3 font-medium">
                  {i === 0 ? (
                    <input
                      type="checkbox"
                      aria-label="이 페이지 전체 선택"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectable.length === 0}
                    />
                  ) : (
                    column
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const issues = issueMessages(item);
              return (
                <tr key={item.id} className="border-b border-slate-100 align-top text-slate-700 last:border-0">
                  <td className="px-4 py-3">
                    {item.state !== "published" ? (
                      <input
                        type="checkbox"
                        aria-label={`${item.region} ${item.keyword} 선택`}
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{item.region}</span>
                    <span className="text-slate-400"> · </span>
                    {item.keyword}
                  </td>
                  <td className="px-4 py-3">
                    <span className="block text-slate-900">{item.business_name}</span>
                    <span className="block text-xs text-slate-500">{item.title}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">/{item.slug}</td>
                  <td className="px-4 py-3">
                    <QueueStateBadge state={item.state} />
                    {item.published_at ? (
                      <span className="mt-1 block text-[11px] text-slate-400">{formatDate(item.published_at)}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {item.max_similarity !== null ? `${Math.floor(Number(item.max_similarity) * 100)}%` : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {issues.length === 0 ? (
                      <span className="text-slate-400">-</span>
                    ) : (
                      <ul className="flex max-w-xs flex-col gap-1 text-xs">
                        {issues.map((issue, i) => (
                          <li key={i} className={issue.level === "error" ? "text-red-700" : "text-amber-700"}>
                            {issue.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2 text-xs font-medium">
                      {item.state === "published" ? (
                        item.landing_page_id ? (
                          <Link href={`/admin/pages/${item.landing_page_id}/edit`} className="text-blue-600 hover:text-blue-700">
                            페이지 보기
                          </Link>
                        ) : (
                          <span className="text-slate-400">페이지 삭제됨</span>
                        )
                      ) : (
                        <>
                          <Link href={`/admin/queue/${item.id}/edit`} className="text-blue-600 hover:text-blue-700">
                            수정
                          </Link>
                          {item.state === "hold" ? (
                            <button
                              type="button"
                              onClick={() => handleRelease([item.id])}
                              disabled={isPending}
                              className="text-slate-700 hover:text-slate-900 disabled:opacity-50"
                            >
                              공개 대기로
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleDelete([item.id])}
                            disabled={isPending}
                            className="text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
