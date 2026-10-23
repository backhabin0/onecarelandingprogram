"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";

interface PublishedUrlsPanelProps {
  /** 보고 있는 한국 날짜 YYYY-MM-DD */
  date: string;
  /** 오늘(한국 날짜) */
  today: string;
  urls: string[];
  error: string | null;
  /** 날짜를 바꿀 때 유지할 다른 검색 조건(상태·검색어) */
  baseParams: Record<string, string>;
}

/**
 * 하루 동안 공개된 주소 목록(한국 날짜 기준). 한 줄에 하나라서 네이버 서치어드바이저
 * "웹 페이지 수집 요청"에 그대로 붙여넣을 수 있다.
 */
export default function PublishedUrlsPanel({ date, today, urls, error, baseParams }: PublishedUrlsPanelProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const text = urls.join("\n");

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
      setCopyError("복사하지 못했습니다. 아래 상자의 내용을 직접 선택해 복사해주세요.");
    }
  };

  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {date === today ? "오늘 공개된 주소" : `${date} 공개된 주소`}{" "}
            <span className="text-sm font-normal text-slate-500">{urls.length}개</span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            한국 시간 기준 하루 동안 공개된 페이지입니다. 한 줄에 하나씩이라 네이버 서치어드바이저 웹 페이지 수집 요청에
            그대로 붙여넣을 수 있습니다.
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
            disabled={urls.length === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {copied ? "복사됨" : "전체 복사"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {copyError ? <p className="mt-2 text-sm text-red-600">{copyError}</p> : null}
      {urls.length > 0 ? (
        <textarea
          readOnly
          aria-label="공개된 주소 목록"
          className="mt-3 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800"
          value={text}
        />
      ) : !error ? (
        <p className="mt-3 text-sm text-slate-400">이 날 공개된 페이지가 없습니다.</p>
      ) : null}
    </Card>
  );
}
