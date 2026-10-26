"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { HEIC_MESSAGE, isHeicFile } from "@/lib/media/compress";
import { MEDIA_KIND_LABEL, type MediaAsset, type MediaKind } from "@/lib/media/library";
import { uploadToLibrary } from "@/lib/media/upload-client";

const fileInputClassName =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60";

export interface UploadLine {
  name: string;
  status: "waiting" | "uploading" | "done" | "reused" | "error";
  message?: string;
}

const STATUS_TEXT: Record<UploadLine["status"], string> = {
  waiting: "기다리는 중",
  uploading: "줄이고 올리는 중...",
  done: "올림",
  reused: "이미 있는 사진(새로 저장 안 함)",
  error: "실패",
};

interface MediaUploadInputProps {
  kind: MediaKind;
  /** 여러 장 한꺼번에(보관함 화면) / 한 장(고르기 창) */
  multiple?: boolean;
  /** 한 장씩 끝날 때마다 */
  onUploaded: (asset: MediaAsset) => void;
  /** 모두 끝났을 때 */
  onFinished?: () => void;
  inputId?: string;
}

/**
 * 보관함 업로드 칸. 고른 파일을 한 장씩 브라우저에서 줄여(사진 1600px·로고 512px) 올리고 줄마다 결과를 보여 준다.
 * HEIC는 올리지 않고 안내 문구를 띄운다.
 */
export default function MediaUploadInput({
  kind,
  multiple = false,
  onUploaded,
  onFinished,
  inputId = "media-upload",
}: MediaUploadInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<UploadLine[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (index: number, line: Partial<UploadLine>) =>
    setLines((current) => current.map((item, i) => (i === index ? { ...item, ...line } : item)));

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setLines(files.map((file) => ({ name: file.name, status: "waiting" })));

    for (const [index, file] of files.entries()) {
      if (isHeicFile(file)) {
        update(index, { status: "error", message: HEIC_MESSAGE });
        continue;
      }
      update(index, { status: "uploading" });
      const result = await uploadToLibrary(file, kind);
      if ("error" in result) {
        update(index, { status: "error", message: result.error });
        continue;
      }
      update(index, {
        status: result.reused ? "reused" : "done",
        message: result.reused ? `보관함 이름: ${result.asset.name}` : undefined,
      });
      onUploaded(result.asset);
    }

    if (inputRef.current) inputRef.current.value = "";
    setBusy(false);
    onFinished?.();
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        {MEDIA_KIND_LABEL[kind]} {multiple ? "여러 장 올리기" : "새로 올리기"}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        // HEIC도 고를 수는 있게 두고, 고르면 안내 문구를 보여 준다.
        accept="image/jpeg,image/png,image/webp,.heic,.heif"
        multiple={multiple}
        disabled={busy}
        onChange={handleChange}
        className={fileInputClassName}
      />
      <p className="text-xs text-slate-400">
        JPG·PNG·WEBP.{" "}
        {kind === "logo"
          ? "로고는 512px로 줄이고 투명 배경을 유지합니다."
          : "사진은 긴 변 1600px WebP로 줄여 저장합니다(위치 정보는 빠짐)."}{" "}
        같은 사진은 한 번만 저장됩니다.
      </p>
      {lines.length > 0 ? (
        <ul aria-label="올리기 결과" className="flex flex-col gap-1 text-xs">
          {lines.map((line, i) => (
            <li
              key={`${line.name}-${i}`}
              className={line.status === "error" ? "text-red-600" : line.status === "uploading" ? "text-blue-600" : "text-slate-600"}
            >
              <span className="font-medium">{line.name}</span> — {STATUS_TEXT[line.status]}
              {line.message ? ` · ${line.message}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
