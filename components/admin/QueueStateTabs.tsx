import Link from "next/link";
import { QUEUE_STATE_LABELS } from "@/lib/publish-queue-labels";
import type { QueueStateCounts, QueueStateFilter } from "@/lib/publish-queue";

const TAB_ORDER: QueueStateFilter[] = ["all", "ready", "hold", "draft", "failed", "published"];

interface QueueStateTabsProps {
  current: QueueStateFilter;
  counts: QueueStateCounts;
  search: string;
}

/** 공개 대기열 상태 탭(건수 포함). 탭을 바꾸면 1페이지부터, 검색어는 유지한다. */
export default function QueueStateTabs({ current, counts, search }: QueueStateTabsProps) {
  const hrefFor = (state: QueueStateFilter) => {
    const params = new URLSearchParams();
    if (state !== "all") params.set("state", state);
    if (search) params.set("search", search);
    const query = params.toString();
    return `/admin/queue${query ? `?${query}` : ""}`;
  };

  return (
    <nav className="flex flex-wrap gap-1" aria-label="상태">
      {TAB_ORDER.map((state) => {
        const active = state === current;
        return (
          <Link
            key={state}
            href={hrefFor(state)}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              active ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {state === "all" ? "전체" : QUEUE_STATE_LABELS[state]}{" "}
            <span className={active ? "text-slate-300" : "text-slate-400"}>
              {counts[state].toLocaleString()}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
