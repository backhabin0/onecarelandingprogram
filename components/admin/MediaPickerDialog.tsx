"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import MediaUploadInput from "@/components/admin/MediaUploadInput";
import { listMediaAssetsAction } from "@/app/admin/media/actions";
import { MEDIA_KIND_LABEL, formatBytes, type MediaAsset, type MediaKind } from "@/lib/media/library";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

interface MediaPickerDialogProps {
  /** 처음 보여 줄 종류(사진 칸은 사진, 로고 칸은 로고) */
  kind: MediaKind;
  title: string;
  onSelect: (asset: MediaAsset) => void;
  onClose: () => void;
}

const PAGE_SIZE = 24;

/** "보관함에서 고르기" 창: 검색·종류·더 보기, 새로 올리면 바로 고른다 */
export default function MediaPickerDialog({ kind, title, onSelect, onClose }: MediaPickerDialogProps) {
  const [filterKind, setFilterKind] = useState<MediaKind>(kind);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextKind: MediaKind, nextSearch: string, nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMediaAssetsAction({ kind: nextKind, search: nextSearch, page: nextPage });
      if (result.error) setError(result.error);
      setItems((current) => (nextPage === 1 ? result.data : [...current, ...result.data]));
      setCount(result.count);
    } catch {
      setError("사진 보관함을 불러오지 못했습니다.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // 창을 열 때·종류/검색어를 바꿀 때 첫 페이지부터 다시 불러온다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filterKind, search, 1);
  }, [filterKind, search, load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 이 창은 페이지 수정 폼 안에서 열린다. 검색 제출이 바깥 폼(페이지 저장)으로 번지지 않게 막는다.
    event.stopPropagation();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    void load(filterKind, search, next);
  };

  // 바깥 폼 안에 폼이 겹치지 않도록 document.body에 띄운다.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
            닫기
          </button>
        </div>

        <MediaUploadInput kind={filterKind} inputId="picker-upload" onUploaded={onSelect} />

        <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <form onSubmit={handleSearch} className="flex min-w-[200px] flex-1 items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="picker-search" className="text-sm font-medium text-slate-700">
                보관함 검색
              </label>
              <input
                id="picker-search"
                className={inputClassName}
                placeholder="사진 이름"
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
          <div className="flex gap-1 text-sm" role="group" aria-label="종류">
            {(["photo", "logo"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filterKind === value}
                onClick={() => {
                  setPage(1);
                  setFilterKind(value);
                }}
                className={`rounded-md border px-3 py-2 ${
                  filterKind === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600"
                }`}
              >
                {MEDIA_KIND_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {!loading && items.length === 0 && !error ? (
          <p className="py-6 text-center text-sm text-slate-500">
            {search ? "검색 결과가 없습니다." : "보관함에 이 종류의 사진이 없습니다. 위에서 새로 올려주세요."}
          </p>
        ) : null}

        <ul aria-label="고를 수 있는 사진" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                onClick={() => onSelect(asset)}
                className="flex w-full flex-col gap-1 rounded-md border border-slate-200 p-2 text-left hover:border-blue-500 hover:bg-blue-50"
              >
                <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.url}
                    alt={asset.name}
                    loading="lazy"
                    className={`h-full w-full ${asset.kind === "logo" ? "object-contain" : "object-cover"}`}
                  />
                </span>
                <span className="break-all text-xs font-medium text-slate-800">{asset.name}</span>
                <span className="text-[11px] text-slate-500">
                  {asset.width}×{asset.height} · {formatBytes(asset.bytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {loading ? <p className="text-center text-sm text-slate-500">불러오는 중...</p> : null}
        {!loading && items.length < count ? (
          <button
            type="button"
            onClick={loadMore}
            className="self-center rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            더 보기 ({items.length.toLocaleString("ko-KR")} / {count.toLocaleString("ko-KR")})
          </button>
        ) : null}
        <p className="text-[11px] text-slate-400">한 번에 {PAGE_SIZE}장씩 보여 줍니다.</p>
      </div>
    </div>,
    document.body
  );
}
