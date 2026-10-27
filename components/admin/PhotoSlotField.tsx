"use client";

import { useState } from "react";
import MediaPickerDialog from "@/components/admin/MediaPickerDialog";
import { altAfterPick, type MediaKind } from "@/lib/media/library";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

interface PhotoSlotFieldProps {
  /** 칸 이름(예: "사진1", "로고") — 입력 id에도 쓴다 */
  id: string;
  label: string;
  kind: MediaKind;
  url: string;
  /** 보관함에서 고른 경우 nextAlt: 설명이 비어 있었으면 보관함 설명(설명 칸이 있는 경우만) */
  onUrlChange: (url: string, nextAlt?: string) => void;
  /** 사진 설명(alt). 로고처럼 설명이 없는 칸은 생략 */
  alt?: string;
  onAltChange?: (alt: string) => void;
  altPlaceholder?: string;
  altMaxLength?: number;
  hint?: string;
  disabled?: boolean;
}

/**
 * 사진 한 칸: 미리보기 + "보관함에서 고르기"(창 안에서 새로 올리기도 됨) + 비우기 + 설명(alt).
 * 값은 사진 주소(보관함 주소 또는 예전 주소)이고, 저장은 이 칸을 쓰는 폼이 한다.
 */
export default function PhotoSlotField({
  id,
  label,
  kind,
  url,
  onUrlChange,
  alt,
  onAltChange,
  altPlaceholder,
  altMaxLength = 200,
  hint,
  disabled = false,
}: PhotoSlotFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div
        className={`flex items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 ${
          kind === "logo" ? "h-20 w-20" : "h-36 w-full"
        }`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${label} 미리보기`} className={`h-full w-full ${kind === "logo" ? "object-contain" : "object-cover"}`} />
        ) : (
          <span className="text-xs text-slate-400">없음</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-medium">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={disabled}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          보관함에서 고르기 / 새로 올리기
        </button>
        {url ? (
          <button
            type="button"
            onClick={() => onUrlChange("")}
            disabled={disabled}
            className="rounded-md border border-red-100 px-3 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            비우기
          </button>
        ) : null}
      </div>
      {onAltChange ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-alt`} className="text-xs text-slate-600">
            {label} 설명(alt)
          </label>
          <input
            id={`${id}-alt`}
            className={inputClassName}
            value={alt ?? ""}
            maxLength={altMaxLength}
            placeholder={altPlaceholder}
            disabled={disabled}
            onChange={(e) => onAltChange(e.target.value)}
          />
        </div>
      ) : null}
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
      {pickerOpen ? (
        <MediaPickerDialog
          kind={kind}
          title={`${label} 고르기`}
          onClose={() => setPickerOpen(false)}
          onSelect={(asset) => {
            onUrlChange(asset.url, onAltChange ? altAfterPick(alt, asset) : undefined);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
