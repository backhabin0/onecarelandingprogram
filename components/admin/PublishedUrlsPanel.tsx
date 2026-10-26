"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import { setSearchSubmissionCheckAction } from "@/app/admin/queue/actions";

export interface PublishedUrlItem {
  /** landing_pages.id */
  id: string;
  url: string;
  /** 수집 요청 완료 표시(DB, 018 migration) */
  checked: boolean;
}

interface PublishedUrlsPanelProps {
  /** 보고 있는 한국 날짜 YYYY-MM-DD */
  date: string;
  /** 오늘(한국 날짜) */
  today: string;
  items: PublishedUrlItem[];
  error: string | null;
  /** 체크 상태를 불러오지 못했을 때 안내(주소 목록은 그대로 보여 준다) */
  checkError?: string | null;
  /** 날짜를 바꿀 때 유지할 다른 검색 조건(상태·검색어) */
  baseParams: Record<string, string>;
}

/**
 * 하루 동안 공개된 주소 목록(한국 날짜 기준). 네이버 서치어드바이저 "웹 페이지 수집 요청"에
 * 한 줄씩 넣을 수 있게 줄마다 'URL 복사'를 두고, 복사하면 수집 요청 완료로 체크한다.
 * 체크는 DB에 저장해 다른 PC에서도 보인다. '전체 복사'는 체크하지 않는다.
 */
export default function PublishedUrlsPanel({
  date,
  today,
  items,
  error,
  checkError = null,
  baseParams,
}: PublishedUrlsPanelProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 저장한(또는 저장 중인) 체크 상태. 서버에서 새 목록을 받아도 방금 바꾼 값이 먼저 보이게 한다.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());

  const text = items.map((item) => item.url).join("\n");
  const isChecked = (item: PublishedUrlItem) => overrides[item.id] ?? item.checked;
  const checkedCount = items.filter(isChecked).length;

  const changeDate = (next: string) => {
    const params = new URLSearchParams(baseParams);
    if (next && next !== today) params.set("publishedDate", next);
    const query = params.toString();
    router.push(`/admin/queue${query ? `?${query}` : ""}`);
  };

  const handleCopy = async () => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("복사하지 못했습니다. 목록의 주소를 직접 선택해 복사해주세요.");
    }
  };

  const saveChecked = async (item: PublishedUrlItem, checked: boolean) => {
    if (pending.has(item.id)) return;
    const previous = isChecked(item);
    setSaveError(null);
    setOverrides((current) => ({ ...current, [item.id]: checked }));
    setPending((current) => new Set(current).add(item.id));

    let failure: string | null = null;
    try {
      const result = await setSearchSubmissionCheckAction(item.id, checked);
      if (!result.success) failure = result.error ?? "수집 요청 완료 표시를 저장하지 못했습니다. 다시 시도해주세요.";
    } catch {
      failure = "수집 요청 완료 표시를 저장하지 못했습니다. 다시 시도해주세요.";
    }

    if (failure) {
      // 저장하지 못했으면 화면의 체크를 원래대로 되돌린다.
      setOverrides((current) => ({ ...current, [item.id]: previous }));
      setSaveError(failure);
    }
    setPending((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  };

  const handleCopyOne = async (item: PublishedUrlItem) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(item.url);
    } catch {
      setCopyError("복사하지 못했습니다. 주소를 직접 선택해 복사해주세요.");
      return;
    }
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 2000);
    if (!isChecked(item)) await saveChecked(item, true);
  };

  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {date === today ? "오늘 공개된 주소" : `${date} 공개된 주소`}{" "}
            <span className="text-sm font-normal text-slate-500">{items.length}개</span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            한국 시간 기준 하루 동안 공개된 페이지입니다. 네이버 서치어드바이저 웹 페이지 수집 요청에 넣을 때
            줄마다 &apos;URL 복사&apos;를 누르면 수집 요청 완료로 체크됩니다(직접 체크·해제도 가능).
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            날짜
            <input
              id="publishedDate"
              type="date"
              max={today}
              value={date}
              onChange={(e) => changeDate(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <button
            type="button"
            onClick={handleCopy}
            disabled={items.length === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {copied ? "복사됨" : "전체 복사"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {checkError ? <p className="mt-2 text-sm text-amber-700">{checkError}</p> : null}
      {copyError ? <p className="mt-2 text-sm text-red-600">{copyError}</p> : null}
      {saveError ? <p className="mt-2 text-sm text-red-600">{saveError}</p> : null}
      {items.length > 0 ? (
        <>
          <p className="mt-3 text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{checkedCount}</span> / {items.length} 수집요청 완료
          </p>
          <ul aria-label="공개된 주소 목록" className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
            {items.map((item) => {
              const checked = isChecked(item);
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`${item.url} 수집 요청 완료`}
                    checked={checked}
                    disabled={pending.has(item.id)}
                    onChange={(e) => saveChecked(item, e.target.checked)}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate font-mono text-xs ${checked ? "text-slate-400" : "text-slate-800"}`}
                    title={item.url}
                  >
                    {item.url}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyOne(item)}
                    className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    {copiedId === item.id ? "복사됨" : "URL 복사"}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : !error ? (
        <p className="mt-3 text-sm text-slate-400">이 날 공개된 페이지가 없습니다.</p>
      ) : null}
    </Card>
  );
}
