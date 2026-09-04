"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  removeLandingPageImageByUrl,
  uploadLandingPageImage,
  validateImageFile,
  type LandingImageKind,
} from "@/lib/storage/landing-page-assets";
import { updateLandingPageImageAction } from "@/app/admin/pages/actions";

const fileInputClassName =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60";

const KIND_LABEL: Record<LandingImageKind, string> = {
  logo: "로고",
  main: "메인 이미지",
};

interface ImageUploadFieldProps {
  kind: LandingImageKind;
  label: string;
  hint?: string;
  /** 존재하면 edit 모드(선택 즉시 업로드/DB 저장/삭제), 없으면 create 모드(선택만 상위로 전달) */
  landingPageId?: string;
  currentUrl?: string | null;
  /** create 모드에서 선택된 파일을 상위 폼으로 전달한다 */
  onFileSelected?: (file: File | null) => void;
}

export default function ImageUploadField({
  kind,
  label,
  hint,
  landingPageId,
  currentUrl = null,
  onFileSelected,
}: ImageUploadFieldProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [displayUrl, setDisplayUrl] = useState<string | null>(currentUrl);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const field = kind === "logo" ? "logo_url" : "main_image_url";
  const objectFitClass = kind === "logo" ? "object-contain" : "object-cover";

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setError(null);

    if (!file) return;

    const validation = validateImageFile(file, kind);
    if (!validation.valid) {
      setError(validation.error ?? "이미지를 업로드하지 못했습니다.");
      resetInput();
      return;
    }

    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(URL.createObjectURL(file));

    if (!landingPageId) {
      // create 모드: 아직 페이지 id가 없으므로 업로드는 상위 폼이 생성 이후에 처리한다.
      onFileSelected?.(file);
      return;
    }

    setIsBusy(true);
    const supabase = getSupabaseBrowserClient();

    const uploadResult = await uploadLandingPageImage(
      supabase,
      landingPageId,
      kind,
      file
    );

    if (!uploadResult.url) {
      setError(uploadResult.error ?? "이미지를 업로드하지 못했습니다.");
      setIsBusy(false);
      resetInput();
      return;
    }

    const saveResult = await updateLandingPageImageAction(
      landingPageId,
      field,
      uploadResult.url
    );

    if (!saveResult.success) {
      // DB 반영에 실패했으므로 방금 올린 새 파일은 정리하고, 기존 이미지는 그대로 둔다.
      await removeLandingPageImageByUrl(supabase, uploadResult.url);
      setError(saveResult.error ?? "이미지 정보를 저장하지 못했습니다.");
      setIsBusy(false);
      resetInput();
      return;
    }

    const previousUrl = displayUrl;
    setDisplayUrl(uploadResult.url);
    setLocalPreview(null);
    resetInput();
    setIsBusy(false);
    router.refresh();

    if (previousUrl) {
      void removeLandingPageImageByUrl(supabase, previousUrl);
    }
  };

  const handleDelete = async () => {
    if (!landingPageId || !displayUrl || isBusy) return;

    const confirmed = window.confirm(
      `현재 ${KIND_LABEL[kind]} 이미지를 삭제하시겠습니까?`
    );
    if (!confirmed) return;

    setIsBusy(true);
    setError(null);

    const saveResult = await updateLandingPageImageAction(
      landingPageId,
      field,
      null
    );

    if (!saveResult.success) {
      setError(saveResult.error ?? "이미지를 삭제하지 못했습니다.");
      setIsBusy(false);
      return;
    }

    const removedUrl = displayUrl;
    setDisplayUrl(null);
    setIsBusy(false);
    router.refresh();

    void removeLandingPageImageByUrl(getSupabaseBrowserClient(), removedUrl);
  };

  const previewSrc = localPreview ?? displayUrl;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>

      {previewSrc ? (
        <div
          className={`flex items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 ${
            kind === "logo" ? "h-20 w-20" : "h-40 w-full"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt={label}
            className={`h-full w-full ${objectFitClass}`}
          />
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className={fileInputClassName}
        disabled={isBusy}
        onChange={handleFileChange}
      />

      {isBusy ? <p className="text-xs text-blue-600">업로드 중...</p> : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}

      {landingPageId && displayUrl && !isBusy ? (
        <button
          type="button"
          onClick={handleDelete}
          className="self-start rounded-md border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          이미지 삭제
        </button>
      ) : null}
    </div>
  );
}
