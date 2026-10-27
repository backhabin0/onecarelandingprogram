"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import PhotoSlotField from "@/components/admin/PhotoSlotField";
import { updateLandingPagePhotosAction } from "@/app/admin/pages/actions";
import { LOCAL_SEO_MAX_LENGTH } from "@/lib/landing-page-validation";
import type { LandingPagePhotosInput } from "@/types/landing-page";

export const EMPTY_PHOTOS: LandingPagePhotosInput = {
  logoUrl: "",
  mainImageUrl: "",
  mainImageAlt: "",
  image2Url: "",
  image2Alt: "",
  image3Url: "",
  image3Alt: "",
};

interface LandingPagePhotosCardProps {
  photos: LandingPagePhotosInput;
  onChange: (photos: LandingPagePhotosInput) => void;
  /** 있으면 수정 화면: "사진 저장" 버튼으로 바로 저장. 없으면 만들기 화면(페이지와 함께 저장) */
  landingPageId?: string;
}

/**
 * 페이지 사진·로고 칸: 로고 + 사진 3장(각 설명). 사진1은 첫 화면 대표 사진·og:image에 쓰고,
 * 사진2·3은 본문 아래 사진 갤러리에 보인다. 모두 사진 보관함에서 고르거나 새로 올린다.
 */
export default function LandingPagePhotosCard({ photos, onChange, landingPageId }: LandingPagePhotosCardProps) {
  const router = useRouter();
  const [isSaving, startSaving] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const set = (field: keyof LandingPagePhotosInput) => (value: string) => {
    setMessage(null);
    onChange({ ...photos, [field]: value });
  };

  /** 사진 칸: 주소와 (보관함에서 고른 경우) 비어 있던 설명을 한 번에 바꾼다 */
  const setPhoto =
    (urlField: keyof LandingPagePhotosInput, altField: keyof LandingPagePhotosInput) =>
    (url: string, nextAlt?: string) => {
      setMessage(null);
      onChange({ ...photos, [urlField]: url, ...(nextAlt !== undefined ? { [altField]: nextAlt } : {}) });
    };

  const handleSave = () => {
    if (!landingPageId || isSaving) return;
    setMessage(null);
    startSaving(async () => {
      const result = await updateLandingPagePhotosAction(landingPageId, photos);
      if (!result.success) {
        setMessage({ type: "error", text: result.error ?? "사진 정보를 저장하지 못했습니다." });
        return;
      }
      setMessage({ type: "success", text: "사진을 저장했습니다." });
      router.refresh();
    });
  };

  const altMax = LOCAL_SEO_MAX_LENGTH.mainImageAlt;

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">사진·로고</h2>
      <p className="mt-1 text-sm text-slate-500">
        사진 보관함에서 고르거나 새로 올립니다. 사진1은 첫 화면 대표 사진과 공유 미리보기(og:image)에, 사진2·3은
        본문 사진 갤러리에 보입니다.{" "}
        {landingPageId ? "고른 뒤 아래 '사진 저장'을 눌러야 반영됩니다." : "페이지를 만들 때 함께 저장됩니다."}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <PhotoSlotField
          id="photo-logo"
          label="로고"
          kind="logo"
          url={photos.logoUrl}
          onUrlChange={set("logoUrl")}
          disabled={isSaving}
          hint="비워 두면 업체명이 대표 업체(설정)와 같은 페이지는 대표 업체 로고를 씁니다."
        />
        <PhotoSlotField
          id="photo-1"
          label="사진1(대표)"
          kind="photo"
          url={photos.mainImageUrl}
          onUrlChange={setPhoto("mainImageUrl", "mainImageAlt")}
          alt={photos.mainImageAlt}
          onAltChange={set("mainImageAlt")}
          altMaxLength={altMax}
          altPlaceholder="비우면 '지역 키워드 현장'으로 자동"
          disabled={isSaving}
        />
        <PhotoSlotField
          id="photo-2"
          label="사진2"
          kind="photo"
          url={photos.image2Url}
          onUrlChange={setPhoto("image2Url", "image2Alt")}
          alt={photos.image2Alt}
          onAltChange={set("image2Alt")}
          altMaxLength={altMax}
          altPlaceholder="예: 산본동 배관 교체 후 모습"
          disabled={isSaving}
        />
        <PhotoSlotField
          id="photo-3"
          label="사진3"
          kind="photo"
          url={photos.image3Url}
          onUrlChange={setPhoto("image3Url", "image3Alt")}
          alt={photos.image3Alt}
          onAltChange={set("image3Alt")}
          altMaxLength={altMax}
          disabled={isSaving}
        />
      </div>
      {landingPageId ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {isSaving ? "저장 중..." : "사진 저장"}
          </button>
          {message ? (
            <span className={`text-sm ${message.type === "error" ? "text-red-600" : "text-green-700"}`}>{message.text}</span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
