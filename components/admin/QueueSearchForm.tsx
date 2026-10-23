"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface QueueSearchFormProps {
  currentSearch: string;
  currentState: string;
}

/** 지역·키워드·업체명·제목·URL 검색. 검색하면 1페이지부터, 상태 탭은 유지한다. */
export default function QueueSearchForm({ currentSearch, currentState }: QueueSearchFormProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(currentSearch);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (currentState !== "all") params.set("state", currentState);
    const term = searchInput.trim();
    if (term) params.set("search", term);
    const query = params.toString();
    router.push(`/admin/queue${query ? `?${query}` : ""}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex min-w-[220px] flex-1 items-end gap-2">
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="queue-search" className="text-sm font-medium text-slate-700">
          검색
        </label>
        <input
          id="queue-search"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="지역, 키워드, 업체명, 제목, URL"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>
      <button
        type="submit"
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        검색
      </button>
    </form>
  );
}
