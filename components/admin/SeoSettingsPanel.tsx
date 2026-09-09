"use client";

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import type { LandingPage } from "@/types/landing-page";
import type { LandingPageSeoSettings, UpdateSeoSettingsInput } from "@/types/seo";
import { resolveLandingPageSeo, getSeoFieldSource } from "@/lib/seo-resolver";
import { buildSeoTitle, buildSeoDescription } from "@/lib/seo-auto";
import {
  removeLandingPageImageByUrl,
  uploadLandingPageImage,
  validateImageFile,
} from "@/lib/storage/landing-page-assets";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import {
  resetSeoOverridesAction,
  updateSeoOgImageAction,
  updateSeoSettingsAction,
} from "@/app/admin/pages/actions";

interface SeoSettingsPanelProps {
  landingPage: LandingPage;
  initialSeoSettings: LandingPageSeoSettings | null;
  /** 미리보기 "FAQ: 자동 N개 + 수동 N개" 문구용. FaqManager와 별도 조회이므로 초기값만 표시한다. */
  autoFaqCount: number;
  manualFaqCount: number;
}

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

const fileInputClassName =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60";

function SourceBadge({ source }: { source: "auto" | "manual" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        source === "manual"
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {source === "manual" ? "직접 설정" : "자동"}
    </span>
  );
}

function emptyValues(seoSettings: LandingPageSeoSettings | null): UpdateSeoSettingsInput {
  return {
    seoTitle: seoSettings?.seo_title ?? "",
    seoDescription: seoSettings?.seo_description ?? "",
    ogTitle: seoSettings?.og_title ?? "",
    ogDescription: seoSettings?.og_description ?? "",
    businessCategory: seoSettings?.business_category ?? "",
    serviceArea: seoSettings?.service_area ?? "",
    seoNoindex: seoSettings?.seo_noindex ?? false,
    disableAutoFaq: seoSettings?.disable_auto_faq ?? false,
  };
}

export default function SeoSettingsPanel({
  landingPage,
  initialSeoSettings,
  autoFaqCount,
  manualFaqCount,
}: SeoSettingsPanelProps) {
  const landingPageId = landingPage.id;
  const slug = landingPage.slug;

  const [values, setValues] = useState<UpdateSeoSettingsInput>(() =>
    emptyValues(initialSeoSettings)
  );
  const [ogImageUrl, setOgImageUrl] = useState<string | null>(
    initialSeoSettings?.og_image_url ?? null
  );
  const [isSaving, startSaving] = useTransition();
  const [isResetting, startResetting] = useTransition();
  const [isImageBusy, setIsImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateField = <K extends keyof UpdateSeoSettingsInput>(
    field: K,
    value: UpdateSeoSettingsInput[K]
  ) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  // 저장 전 현재 입력값 기준으로 실제 적용될 값을 즉시 미리보기한다.
  const previewSeoSettings: LandingPageSeoSettings = {
    landing_page_id: landingPageId,
    seo_title: values.seoTitle || null,
    seo_description: values.seoDescription || null,
    og_title: values.ogTitle || null,
    og_description: values.ogDescription || null,
    og_image_url: ogImageUrl,
    seo_noindex: values.seoNoindex,
    business_category: values.businessCategory || null,
    service_area: values.serviceArea || null,
    disable_auto_faq: values.disableAutoFaq,
    created_at: initialSeoSettings?.created_at ?? "",
    updated_at: initialSeoSettings?.updated_at ?? "",
  };
  const resolved = resolveLandingPageSeo(landingPage, previewSeoSettings);
  const autoTitle = buildSeoTitle(landingPage);
  const autoDescription = buildSeoDescription(landingPage);

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    startSaving(async () => {
      const result = await updateSeoSettingsAction(landingPageId, slug, values);
      setMessage(
        result.success
          ? { type: "success", text: "SEO 설정을 저장했습니다." }
          : { type: "error", text: result.error ?? "저장하지 못했습니다." }
      );
    });
  };

  const handleReset = () => {
    setMessage(null);
    startResetting(async () => {
      const result = await resetSeoOverridesAction(landingPageId, slug);
      if (result.success) {
        setValues((prev) => ({
          ...prev,
          seoTitle: "",
          seoDescription: "",
          ogTitle: "",
          ogDescription: "",
        }));
        setMessage({ type: "success", text: "자동값으로 되돌렸습니다." });
      } else {
        setMessage({ type: "error", text: result.error ?? "되돌리지 못했습니다." });
      }
    });
  };

  const handleOgImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setImageError(null);
    if (!file) return;

    const validation = await validateImageFile(file, "og");
    if (!validation.valid) {
      setImageError(validation.error ?? "이미지를 업로드하지 못했습니다.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsImageBusy(true);
    const supabase = getSupabaseBrowserClient();
    const uploadResult = await uploadLandingPageImage(supabase, landingPageId, "og", file);

    if (!uploadResult.url) {
      setImageError(uploadResult.error ?? "이미지를 업로드하지 못했습니다.");
      setIsImageBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const saveResult = await updateSeoOgImageAction(landingPageId, slug, uploadResult.url);

    if (!saveResult.success) {
      await removeLandingPageImageByUrl(supabase, uploadResult.url);
      setImageError(saveResult.error ?? "OG 이미지 정보를 저장하지 못했습니다.");
      setIsImageBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const previousUrl = ogImageUrl;
    setOgImageUrl(uploadResult.url);
    setIsImageBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (previousUrl) {
      void removeLandingPageImageByUrl(supabase, previousUrl);
    }
  };

  const handleOgImageRemove = async () => {
    if (!ogImageUrl || isImageBusy) return;
    setIsImageBusy(true);
    setImageError(null);

    const result = await updateSeoOgImageAction(landingPageId, slug, null);

    if (!result.success) {
      setImageError(result.error ?? "OG 이미지를 삭제하지 못했습니다.");
      setIsImageBusy(false);
      return;
    }

    const removedUrl = ogImageUrl;
    setOgImageUrl(null);
    setIsImageBusy(false);
    void removeLandingPageImageByUrl(getSupabaseBrowserClient(), removedUrl);
  };

  const faqStatusText = values.disableAutoFaq
    ? `수동 ${manualFaqCount}개 (자동 FAQ 꺼짐)`
    : `자동 ${autoFaqCount}개 + 수동 ${manualFaqCount}개`;

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">
        SEO / 검색 · AI 노출 설정
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        비워두면 업체 정보를 기반으로 자동 생성된 값이 사용됩니다. 이 설정은
        검색순위나 AI 추천 노출을 보장하지 않습니다.
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

      <form onSubmit={handleSave} className="mt-4 flex flex-col gap-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">검색 결과 설정</h3>
          <div className="mt-3 grid grid-cols-1 gap-4">
            <FormField
              label="SEO 제목"
              htmlFor="seoTitle"
              hint={`비워두면 자동 사용: ${autoTitle} · ${values.seoTitle.length}/${120}자`}
            >
              <div className="flex items-center gap-2">
                <input
                  id="seoTitle"
                  className={inputClassName}
                  placeholder={autoTitle}
                  value={values.seoTitle}
                  maxLength={120}
                  onChange={(e) => updateField("seoTitle", e.target.value)}
                />
                <SourceBadge source={getSeoFieldSource(values.seoTitle)} />
              </div>
            </FormField>
            <FormField
              label="SEO 설명"
              htmlFor="seoDescription"
              hint={`비워두면 자동 사용: ${autoDescription} · ${values.seoDescription.length}/${320}자 (권장 길이일 뿐 절대 기준은 아닙니다)`}
            >
              <div className="flex items-start gap-2">
                <textarea
                  id="seoDescription"
                  rows={3}
                  className={inputClassName}
                  placeholder={autoDescription}
                  value={values.seoDescription}
                  maxLength={320}
                  onChange={(e) => updateField("seoDescription", e.target.value)}
                />
                <SourceBadge source={getSeoFieldSource(values.seoDescription)} />
              </div>
            </FormField>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={values.seoNoindex}
                onChange={(e) => updateField("seoNoindex", e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              검색엔진 색인 차단 (noindex) — 페이지는 계속 정상 접근되지만
              검색결과와 sitemap에서는 제외됩니다.
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-800">공유 설정 (Open Graph)</h3>
          <div className="mt-3 grid grid-cols-1 gap-4">
            <FormField
              label="OG 제목"
              htmlFor="ogTitle"
              hint={`비워두면 SEO 제목 또는 자동값 사용 · ${values.ogTitle.length}/${120}자`}
            >
              <div className="flex items-center gap-2">
                <input
                  id="ogTitle"
                  className={inputClassName}
                  placeholder={resolved.ogTitle}
                  value={values.ogTitle}
                  maxLength={120}
                  onChange={(e) => updateField("ogTitle", e.target.value)}
                />
                <SourceBadge source={getSeoFieldSource(values.ogTitle)} />
              </div>
            </FormField>
            <FormField
              label="OG 설명"
              htmlFor="ogDescription"
              hint={`비워두면 SEO 설명 또는 자동값 사용 · ${values.ogDescription.length}/${320}자`}
            >
              <div className="flex items-start gap-2">
                <textarea
                  id="ogDescription"
                  rows={2}
                  className={inputClassName}
                  placeholder={resolved.ogDescription}
                  value={values.ogDescription}
                  maxLength={320}
                  onChange={(e) => updateField("ogDescription", e.target.value)}
                />
                <SourceBadge source={getSeoFieldSource(values.ogDescription)} />
              </div>
            </FormField>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">OG 이미지</span>
              {resolved.ogImage ? (
                <div className="flex h-32 w-full max-w-xs items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolved.ogImage}
                    alt="OG 이미지 미리보기"
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className={fileInputClassName}
                disabled={isImageBusy}
                onChange={handleOgImageChange}
              />
              {isImageBusy ? (
                <p className="text-xs text-blue-600">처리 중...</p>
              ) : null}
              {imageError ? (
                <p className="text-xs text-red-600">{imageError}</p>
              ) : null}
              <p className="text-xs text-slate-400">
                JPG, PNG, WEBP · 최대 5MB. 비워두면 메인 이미지 → 로고 순으로
                자동 사용됩니다.
              </p>
              {ogImageUrl && !isImageBusy ? (
                <button
                  type="button"
                  onClick={handleOgImageRemove}
                  className="self-start rounded-md border border-red-100 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  전용 OG 이미지 삭제
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-800">업체 정보</h3>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="업종 / 카테고리"
              htmlFor="businessCategory"
              hint="예: 헬스장, 필라테스, 미용실 (선택)"
            >
              <input
                id="businessCategory"
                className={inputClassName}
                value={values.businessCategory}
                maxLength={100}
                onChange={(e) => updateField("businessCategory", e.target.value)}
              />
            </FormField>
            <FormField
              label="서비스 지역"
              htmlFor="serviceArea"
              hint="예: 서울 강남구 (선택, 실제 서비스 지역일 때만 입력)"
            >
              <input
                id="serviceArea"
                className={inputClassName}
                value={values.serviceArea}
                maxLength={200}
                onChange={(e) => updateField("serviceArea", e.target.value)}
              />
            </FormField>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-800">FAQ / AEO</h3>
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={values.disableAutoFaq}
                onChange={(e) => updateField("disableAutoFaq", e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              자동 FAQ 끄기 — 아래 &quot;수동 FAQ 관리&quot;에서 등록한 FAQ만
              사용합니다.
            </label>
            <p className="text-xs text-slate-400">
              현재 FAQ 구성: {faqStatusText} (수동 FAQ는 아래에서 관리합니다)
            </p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-800">미리보기</h3>
          <dl className="mt-3 flex flex-col gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-slate-500">SEO 제목</dt>
              <dd className="break-all">{resolved.title}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-slate-500">SEO 설명</dt>
              <dd className="break-all">{resolved.description}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-slate-500">Canonical</dt>
              <dd className="break-all">{resolved.canonical}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-slate-500">검색 색인</dt>
              <dd>{resolved.robots.index ? "허용" : "차단(noindex)"}</dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={isResetting || isSaving}
            className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isResetting ? "되돌리는 중..." : "제목/설명/OG 자동값으로 되돌리기"}
          </button>
          <button
            type="submit"
            disabled={isSaving || isResetting}
            className={`rounded-md px-5 py-2.5 text-sm font-medium text-white ${
              isSaving ? "cursor-not-allowed bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isSaving ? "저장 중..." : "SEO 설정 저장"}
          </button>
        </div>
      </form>
    </Card>
  );
}
