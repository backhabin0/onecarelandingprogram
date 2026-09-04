"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import FormField from "@/components/admin/FormField";
import Card from "@/components/admin/Card";
import TemplateSelector from "@/components/admin/TemplateSelector";
import ImageUploadField from "@/components/admin/ImageUploadField";
import { mockTemplates } from "@/lib/mock-data";
import {
  createLandingPageAction,
  updateLandingPageAction,
  updateLandingPageImageAction,
} from "@/app/admin/pages/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { uploadLandingPageImage } from "@/lib/storage/landing-page-assets";
import type {
  CreateLandingPageInput,
  LandingPageStatus,
} from "@/types/landing-page";

const DEFAULT_VALUES: CreateLandingPageInput = {
  businessName: "",
  title: "",
  slug: "",
  heroText: "",
  description: "",
  phone: "",
  kakaoUrl: "",
  address: "",
  template: mockTemplates[0]?.id ?? "template-a",
  status: "private",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

interface LandingPageFormProps {
  mode?: "create" | "edit";
  landingPageId?: string;
  initialValues?: CreateLandingPageInput;
  initialLogoUrl?: string | null;
  initialMainImageUrl?: string | null;
}

export default function LandingPageForm({
  mode = "create",
  landingPageId,
  initialValues,
  initialLogoUrl = null,
  initialMainImageUrl = null,
}: LandingPageFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<CreateLandingPageInput>(
    initialValues ?? DEFAULT_VALUES
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [mainImageFile, setMainImageFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateField = <K extends keyof CreateLandingPageInput>(
    field: K,
    value: CreateLandingPageInput[K]
  ) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    if (mode === "edit" && landingPageId) {
      const result = await updateLandingPageAction(landingPageId, values);

      if (!result.success) {
        setErrorMessage(result.error ?? "저장 중 오류가 발생했습니다.");
        setIsSubmitting(false);
        return;
      }

      router.push("/admin/pages");
      return;
    }

    const createResult = await createLandingPageAction(values);

    if (!createResult.success || !createResult.id) {
      setErrorMessage(createResult.error ?? "저장 중 오류가 발생했습니다.");
      setIsSubmitting(false);
      return;
    }

    const newId = createResult.id;
    const imageWarnings: string[] = [];
    const supabase = getSupabaseBrowserClient();

    if (logoFile) {
      const uploadResult = await uploadLandingPageImage(
        supabase,
        newId,
        "logo",
        logoFile
      );

      if (!uploadResult.url) {
        imageWarnings.push(
          uploadResult.error ?? "로고 이미지 업로드에 실패했습니다."
        );
      } else {
        const saveResult = await updateLandingPageImageAction(
          newId,
          "logo_url",
          uploadResult.url
        );
        if (!saveResult.success) {
          imageWarnings.push(
            saveResult.error ?? "로고 이미지 저장에 실패했습니다."
          );
        }
      }
    }

    if (mainImageFile) {
      const uploadResult = await uploadLandingPageImage(
        supabase,
        newId,
        "main",
        mainImageFile
      );

      if (!uploadResult.url) {
        imageWarnings.push(
          uploadResult.error ?? "메인 이미지 업로드에 실패했습니다."
        );
      } else {
        const saveResult = await updateLandingPageImageAction(
          newId,
          "main_image_url",
          uploadResult.url
        );
        if (!saveResult.success) {
          imageWarnings.push(
            saveResult.error ?? "메인 이미지 저장에 실패했습니다."
          );
        }
      }
    }

    if (imageWarnings.length > 0) {
      window.alert(
        `랜딩페이지는 생성되었지만 일부 이미지 처리에 실패했습니다.\n\n${imageWarnings.join(
          "\n"
        )}\n\n수정 화면에서 다시 업로드할 수 있습니다.`
      );
      router.push(`/admin/pages/${newId}/edit`);
      return;
    }

    router.push("/admin/pages");
  };

  const handleCancel = () => {
    router.push("/admin/pages");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {errorMessage ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">기본 정보</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="업체명" htmlFor="businessName">
            <input
              id="businessName"
              required
              className={inputClassName}
              placeholder="예: A 헬스장"
              value={values.businessName}
              onChange={(e) => updateField("businessName", e.target.value)}
            />
          </FormField>
          <FormField label="페이지 제목" htmlFor="title">
            <input
              id="title"
              required
              className={inputClassName}
              placeholder="예: PT 무료 상담"
              value={values.title}
              onChange={(e) => updateField("title", e.target.value)}
            />
          </FormField>
          <FormField
            label="URL Slug"
            htmlFor="slug"
            hint="공개 시 /슬러그 형태의 고유 주소로 사용됩니다. (영문 소문자, 숫자, 하이픈만 사용)"
          >
            <input
              id="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다. 예: a-gym"
              className={inputClassName}
              placeholder="예: a-gym"
              value={values.slug}
              onChange={(e) => updateField("slug", e.target.value)}
            />
          </FormField>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">콘텐츠</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="대표 문구" htmlFor="heroText">
            <input
              id="heroText"
              className={inputClassName}
              placeholder="예: 지금 상담하면 첫 달 무료"
              value={values.heroText}
              onChange={(e) => updateField("heroText", e.target.value)}
            />
          </FormField>
          <FormField label="전화번호" htmlFor="phone">
            <input
              id="phone"
              className={inputClassName}
              placeholder="예: 010-1234-5678"
              value={values.phone}
              onChange={(e) => updateField("phone", e.target.value)}
            />
          </FormField>
          <FormField label="카카오톡 URL" htmlFor="kakaoUrl">
            <input
              id="kakaoUrl"
              className={inputClassName}
              placeholder="예: https://pf.kakao.com/_xxxx"
              value={values.kakaoUrl}
              onChange={(e) => updateField("kakaoUrl", e.target.value)}
            />
          </FormField>
          <FormField label="주소" htmlFor="address">
            <input
              id="address"
              className={inputClassName}
              placeholder="예: 서울시 강남구 ..."
              value={values.address}
              onChange={(e) => updateField("address", e.target.value)}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="소개 문구" htmlFor="description">
              <textarea
                id="description"
                rows={4}
                className={inputClassName}
                value={values.description}
                onChange={(e) => updateField("description", e.target.value)}
              />
            </FormField>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">이미지</h2>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "edit"
            ? "이미지를 선택하면 즉시 업로드되어 저장됩니다."
            : "선택한 이미지는 랜딩페이지 생성 후 업로드됩니다."}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <ImageUploadField
            kind="logo"
            label="로고 이미지"
            hint="JPG, PNG, WEBP · 최대 3MB"
            landingPageId={mode === "edit" ? landingPageId : undefined}
            currentUrl={initialLogoUrl}
            onFileSelected={setLogoFile}
          />
          <ImageUploadField
            kind="main"
            label="메인 이미지"
            hint="JPG, PNG, WEBP · 최대 10MB"
            landingPageId={mode === "edit" ? landingPageId : undefined}
            currentUrl={initialMainImageUrl}
            onFileSelected={setMainImageFile}
          />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">템플릿</h2>
        <p className="mt-1 text-sm text-slate-500">
          사용할 템플릿을 선택하세요.
        </p>
        <div className="mt-4">
          <TemplateSelector
            templates={mockTemplates}
            selectedTemplateId={values.template}
            onSelect={(templateId) => updateField("template", templateId)}
          />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">공개 상태</h2>
        <div className="mt-4 flex gap-3">
          {(["public", "private"] as LandingPageStatus[]).map((status) => (
            <label
              key={status}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
                values.status === status
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-300 text-slate-600"
              }`}
            >
              <input
                type="radio"
                name="status"
                value={status}
                checked={values.status === status}
                onChange={() => updateField("status", status)}
                className="sr-only"
              />
              {status === "public" ? "공개" : "비공개"}
            </label>
          ))}
        </div>
      </Card>

      <div className="flex justify-end gap-3 pb-2">
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSubmitting}
          className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className={`rounded-md px-5 py-2.5 text-sm font-medium text-white ${
            isSubmitting
              ? "cursor-not-allowed bg-blue-400"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {mode === "edit"
            ? isSubmitting
              ? "수정 중..."
              : "수정하기"
            : isSubmitting
              ? "생성 중..."
              : "생성하기"}
        </button>
      </div>
    </form>
  );
}
