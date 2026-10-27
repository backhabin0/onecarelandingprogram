"use client";

import { useState } from "react";
import { updateMediaAssetDescriptionAction } from "@/app/admin/media/actions";
import { MEDIA_DESCRIPTION_MAX_LENGTH, type MediaAsset } from "@/lib/media/library";

interface MediaDescriptionFieldProps {
  asset: MediaAsset;
  onSaved?: (asset: MediaAsset) => void;
}

/**
 * 보관함 사진 한 장의 짧은 설명(예: 정화조 작업 현장). 바꾸면 '저장' 버튼이 나온다.
 * 페이지 사진 설명(alt)이 비면 이 설명을 쓰고, AI 프롬프트의 사진 목록에도 들어간다.
 */
export default function MediaDescriptionField({ asset, onSaved }: MediaDescriptionFieldProps) {
  const [saved, setSaved] = useState(asset.description);
  const [value, setValue] = useState(asset.description);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const changed = value.trim() !== saved;

  const handleSave = async () => {
    if (busy || !changed) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateMediaAssetDescriptionAction(asset.id, value);
      if (!result.success || !result.asset) {
        setMessage({ type: "error", text: result.error ?? "설명을 저장하지 못했습니다." });
        return;
      }
      setSaved(result.asset.description);
      setValue(result.asset.description);
      setMessage({ type: "success", text: "저장됨" });
      onSaved?.(result.asset);
    } catch {
      setMessage({ type: "error", text: "설명을 저장하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <input
          aria-label={`${asset.name} 설명`}
          value={value}
          maxLength={MEDIA_DESCRIPTION_MAX_LENGTH}
          placeholder="설명(예: 배관 내시경)"
          onChange={(e) => {
            setValue(e.target.value);
            setMessage(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {changed ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "저장 중" : "저장"}
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={`text-xs ${message.type === "error" ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
