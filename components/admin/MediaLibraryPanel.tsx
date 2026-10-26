"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import MediaUploadInput from "@/components/admin/MediaUploadInput";
import { deleteMediaAssetAction } from "@/app/admin/media/actions";
import { MEDIA_KIND_LABEL, formatBytes, type MediaAsset, type MediaKind } from "@/lib/media/library";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

interface MediaLibraryPanelProps {
  items: MediaAsset[];
  /** 사진 주소별 쓰는 곳 수(본 파일 + OG 파일 주소) */
  usedCounts: Record<string, number>;
  /** 쓰는 곳을 확인하지 못했으면 안내 문구(이때는 삭제 버튼을 막는다) */
  usageError: string | null;
  search: string;
  kind: MediaKind | "all";
}

const KIND_FILTERS: { value: MediaKind | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "photo", label: "사진" },
  { value: "logo", label: "로고" },
];

/** 관리자 "사진 보관함": 여러 장 올리기, 검색, 이름 복사, 삭제(쓰는 사진은 막음) */
export default function MediaLibraryPanel({ items, usedCounts, usageError, search, kind }: MediaLibraryPanelProps) {
  const router = useRouter();
  const [uploadKind, setUploadKind] = useState<MediaKind>("photo");
  const [searchInput, setSearchInput] = useState(search);
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const pushFilter = (next: { search?: string; kind?: MediaKind | "all" }) => {
    const params = new URLSearchParams();
    const term = (next.search ?? search).trim();
    const nextKind = next.kind ?? kind;
    if (term) params.set("search", term);
    if (nextKind !== "all") params.set("kind", nextKind);
    const query = params.toString();
    router.push(`/admin/media${query ? `?${query}` : ""}`);
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    pushFilter({ search: searchInput });
  };

  const handleCopy = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(name);
    } catch {
      setMessage({ type: "error", text: "복사하지 못했습니다. 이름을 직접 선택해 복사해주세요." });
    }
  };

  const handleDelete = (asset: MediaAsset) => {
    if (isPending) return;
    if (!window.confirm(`"${asset.name}" 사진을 보관함에서 지울까요?\n지운 사진은 되살릴 수 없습니다.`)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await deleteMediaAssetAction(asset.id);
      if (!result.success) {
        setMessage({ type: "error", text: result.error ?? "사진을 지우지 못했습니다." });
        return;
      }
      setMessage({ type: "success", text: `"${asset.name}"을(를) 지웠습니다.` });
      router.refresh();
    });
  };

  const usageCount = (asset: MediaAsset) => (usedCounts[asset.url] ?? 0) + (usedCounts[asset.og_url] ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900">올리기</h2>
        <fieldset className="flex gap-3 text-sm">
          <legend className="sr-only">올릴 종류</legend>
          {(["photo", "logo"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="upload-kind"
                value={value}
                checked={uploadKind === value}
                onChange={() => setUploadKind(value)}
              />
              {MEDIA_KIND_LABEL[value]}
            </label>
          ))}
        </fieldset>
        <MediaUploadInput
          key={uploadKind}
          kind={uploadKind}
          multiple
          onUploaded={() => undefined}
          onFinished={() => router.refresh()}
        />
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-end gap-3">
          <form onSubmit={handleSearch} className="flex min-w-[220px] flex-1 items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="media-search" className="text-sm font-medium text-slate-700">
                검색
              </label>
              <input
                id="media-search"
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
            {KIND_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => pushFilter({ kind: filter.value })}
                aria-pressed={kind === filter.value}
                className={`rounded-md border px-3 py-2 ${
                  kind === filter.value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {message ? (
          <p className={`text-sm ${message.type === "error" ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
        ) : null}
        {usageError ? <p className="text-sm text-amber-700">{usageError} 지금은 삭제할 수 없습니다.</p> : null}
        <p className="text-xs text-slate-500">
          엑셀 대량 등록의 사진 칸(대표 사진 URL·사진2·사진3)에 아래 이름을 그대로 쓰면 그 사진이 들어갑니다.
        </p>

        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {search || kind !== "all" ? "조건에 맞는 사진이 없습니다." : "보관함이 비어 있습니다. 위에서 사진을 올려주세요."}
          </p>
        ) : (
          <ul aria-label="보관함 사진 목록" className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((asset) => {
              const used = usageCount(asset);
              return (
                <li key={asset.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
                  <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-slate-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.url}
                      alt={asset.name}
                      loading="lazy"
                      className={`h-full w-full ${asset.kind === "logo" ? "object-contain" : "object-cover"}`}
                    />
                  </div>
                  <p className="break-all text-sm font-medium text-slate-900">{asset.name}</p>
                  <p className="text-xs text-slate-500">
                    {MEDIA_KIND_LABEL[asset.kind]} · {asset.width}×{asset.height} · {formatBytes(asset.bytes + asset.og_bytes)}
                  </p>
                  <p className={`text-xs ${used > 0 ? "text-blue-700" : "text-slate-400"}`}>
                    {used > 0 ? `사용 중 ${used}곳` : "쓰는 곳 없음"}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => handleCopy(asset.name)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50"
                    >
                      {copied === asset.name ? "복사됨" : "이름 복사"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(asset)}
                      disabled={isPending || used > 0 || usageError !== null}
                      title={used > 0 ? "페이지가 쓰고 있는 사진은 지울 수 없습니다." : undefined}
                      className="rounded-md border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
