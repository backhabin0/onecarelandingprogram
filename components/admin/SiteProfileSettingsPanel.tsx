"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import { updateSiteProfileAction } from "@/app/admin/settings/actions";
import type { SiteProfile } from "@/lib/site-profile";

interface SiteProfileSettingsPanelProps {
  initialProfile: SiteProfile;
  maxLength: { businessName: number; description: number; phone: number; kakaoUrl: number };
}

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

/** 공개 홈(/)·/llms.txt에 보이는 사이트 대표 업체 정보 */
export default function SiteProfileSettingsPanel({ initialProfile, maxLength }: SiteProfileSettingsPanelProps) {
  const router = useRouter();
  const [synced, setSynced] = useState(initialProfile);
  const [businessName, setBusinessName] = useState(initialProfile.businessName ?? "");
  const [description, setDescription] = useState(initialProfile.description ?? "");
  const [phone, setPhone] = useState(initialProfile.phone ?? "");
  const [kakaoUrl, setKakaoUrl] = useState(initialProfile.kakaoUrl ?? "");
  const [isSaving, startSaving] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 저장 후 router.refresh()로 내려온 DB 값으로 입력칸을 맞춘다(SiteVerificationSettingsPanel과 같은 방식).
  if (initialProfile !== synced) {
    setSynced(initialProfile);
    setBusinessName(initialProfile.businessName ?? "");
    setDescription(initialProfile.description ?? "");
    setPhone(initialProfile.phone ?? "");
    setKakaoUrl(initialProfile.kakaoUrl ?? "");
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setMessage(null);
    startSaving(async () => {
      const result = await updateSiteProfileAction({ businessName, description, phone, kakaoUrl });
      if (result.success) {
        setMessage({ type: "success", text: "대표 업체 정보를 저장했습니다." });
        router.refresh();
      } else {
        setMessage({ type: "error", text: result.error ?? "대표 업체 정보를 저장하지 못했습니다." });
      }
    });
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">사이트 대표 업체</h2>
      <p className="mt-1 text-sm text-slate-500">
        공개 홈(/)과 /llms.txt에 보이는 업체 정보입니다. 비워 두면 홈에는 업체 소개·연락처 없이 서비스·지역
        링크만 나옵니다. 업체명이 랜딩페이지의 업체명과 똑같으면 그 페이지들의 구조화 데이터도 같은 업체로
        묶입니다. 실제 정보만 입력하세요.
      </p>

      {message ? (
        <div
          className={`mt-4 rounded-md border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <FormField label="업체명" htmlFor="siteBusinessName" hint="예: 원케어배관">
          <input
            id="siteBusinessName"
            className={inputClassName}
            value={businessName}
            maxLength={maxLength.businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            disabled={isSaving}
          />
        </FormField>
        <FormField label="한 줄 소개" htmlFor="siteDescription" hint="홈 설명과 검색 결과 설명에 쓰입니다.">
          <textarea
            id="siteDescription"
            className={inputClassName}
            rows={2}
            value={description}
            maxLength={maxLength.description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSaving}
          />
        </FormField>
        <FormField label="대표 전화번호" htmlFor="sitePhone">
          <input
            id="sitePhone"
            className={inputClassName}
            value={phone}
            maxLength={maxLength.phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={isSaving}
          />
        </FormField>
        <FormField label="카카오톡 상담 URL" htmlFor="siteKakaoUrl">
          <input
            id="siteKakaoUrl"
            className={inputClassName}
            value={kakaoUrl}
            maxLength={maxLength.kakaoUrl}
            onChange={(e) => setKakaoUrl(e.target.value)}
            disabled={isSaving}
          />
        </FormField>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className={`rounded-md px-5 py-2.5 text-sm font-medium text-white ${
              isSaving ? "cursor-not-allowed bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </Card>
  );
}
