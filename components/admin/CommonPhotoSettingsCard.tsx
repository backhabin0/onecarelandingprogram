"use client";

import { useState } from "react";
import Card from "@/components/admin/Card";
import MediaPickerDialog from "@/components/admin/MediaPickerDialog";
import {
  COMMON_PHOTO_SLOTS,
  type CommonPhotoField,
  type CommonPhotoSettings,
} from "@/lib/bulk-upload/common-photos";

interface CommonPhotoSettingsCardProps {
  settings: CommonPhotoSettings;
  onChange: (settings: CommonPhotoSettings) => void;
  disabled?: boolean;
}

/**
 * 올리기 화면 "공통 사진 설정": 로고·대표 사진·현장 사진2·3을 보관함에서 고른다.
 * 사진 칸이 빈 행에만 들어가고(행에 있으면 행 우선), 마지막 선택은 이 브라우저에 기억된다.
 */
export default function CommonPhotoSettingsCard({ settings, onChange, disabled = false }: CommonPhotoSettingsCardProps) {
  const [picking, setPicking] = useState<CommonPhotoField | null>(null);
  const pickingSlot = COMMON_PHOTO_SLOTS.find((slot) => slot.field === picking) ?? null;

  const setSlot = (field: CommonPhotoField, choice: CommonPhotoSettings[CommonPhotoField] | null) => {
    const next = { ...settings };
    if (choice) next[field] = choice;
    else delete next[field];
    onChange(next);
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">공통 사진 설정(선택)</h2>
      <p className="mt-1 text-sm text-slate-500">
        보관함에서 고른 사진을 사진 칸이 빈 행에만 넣습니다. 행에 사진이 있으면 행이 우선이고, 같은 행에 이미 있는
        사진은 다시 넣지 않습니다. 마지막 선택은 이 브라우저에 기억됩니다.
      </p>
      <ul aria-label="공통 사진" className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {COMMON_PHOTO_SLOTS.map(({ field, label, kind }) => {
          const choice = settings[field];
          return (
            <li key={field} className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">{label}</span>
              <div
                className={`flex items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 ${
                  kind === "logo" ? "h-20 w-20" : "h-24 w-full"
                }`}
              >
                {choice ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={choice.url}
                    alt={`${label} 미리보기`}
                    className={`h-full w-full ${kind === "logo" ? "object-contain" : "object-cover"}`}
                  />
                ) : (
                  <span className="text-xs text-slate-400">없음</span>
                )}
              </div>
              {choice ? <span className="break-all text-xs text-slate-600">{choice.name}</span> : null}
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setPicking(field)}
                  disabled={disabled}
                  className="rounded-md border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {choice ? "바꾸기" : "보관함에서 고르기"}
                </button>
                {choice ? (
                  <button
                    type="button"
                    onClick={() => setSlot(field, null)}
                    disabled={disabled}
                    className="rounded-md border border-red-100 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    비우기
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {pickingSlot ? (
        <MediaPickerDialog
          kind={pickingSlot.kind}
          title={`공통 ${pickingSlot.label} 고르기`}
          onClose={() => setPicking(null)}
          onSelect={(asset) => {
            setSlot(pickingSlot.field, { name: asset.name, url: asset.url });
            setPicking(null);
          }}
        />
      ) : null}
    </Card>
  );
}
