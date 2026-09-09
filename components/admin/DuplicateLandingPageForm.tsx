"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import { getAbsoluteUrl } from "@/lib/site";
import { duplicateLandingPageAction } from "@/app/admin/pages/actions";
import type { LandingPageStatus } from "@/types/landing-page";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

interface DuplicateLandingPageFormProps {
  sourceId: string;
  sourceBusinessName: string;
  sourceSlug: string;
  defaultBusinessName: string;
  defaultTitle: string;
  defaultSlug: string;
}

export default function DuplicateLandingPageForm({
  sourceId,
  sourceBusinessName,
  sourceSlug,
  defaultBusinessName,
  defaultTitle,
  defaultSlug,
}: DuplicateLandingPageFormProps) {
  const router = useRouter();
  const [businessName, setBusinessName] = useState(defaultBusinessName);
  const [title, setTitle] = useState(defaultTitle);
  const [slug, setSlug] = useState(defaultSlug);
  const [status, setStatus] = useState<LandingPageStatus>("private");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const confirmed = window.confirm(
      `이 랜딩페이지를 복제하시겠습니까?\n\n원본: ${sourceBusinessName} (/${sourceSlug})\n새 페이지: ${businessName} (/${slug})`
    );
    if (!confirmed) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    const result = await duplicateLandingPageAction(sourceId, {
      businessName,
      title,
      slug,
      status,
    });

    if (!result.success || !result.id) {
      setErrorMessage(result.error ?? "랜딩페이지 복제에 실패했습니다.");
      setIsSubmitting(false);
      return;
    }

    window.alert("랜딩페이지를 복제했습니다.");
    router.push(`/admin/pages/${result.id}/edit`);
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
        <h2 className="text-base font-semibold text-slate-900">원본 페이지</h2>
        <dl className="mt-3 flex flex-col gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-slate-500">업체명</dt>
            <dd>{sourceBusinessName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-slate-500">URL</dt>
            <dd className="break-all">{getAbsoluteUrl(`/${sourceSlug}`)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-400">
          기본 데이터(전화/카카오/주소/소개문구), 템플릿, 이미지, SEO 설정,
          수동 FAQ가 복제됩니다. 상담 신청 내역과 Analytics는 복제되지
          않습니다.
        </p>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900">새 페이지 정보</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="새 업체명" htmlFor="businessName">
            <input
              id="businessName"
              required
              className={inputClassName}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </FormField>
          <FormField label="새 페이지 제목" htmlFor="title">
            <input
              id="title"
              required
              className={inputClassName}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
          <FormField
            label="새 URL Slug"
            htmlFor="slug"
            hint="영문 소문자, 숫자, 하이픈만 사용할 수 있습니다. 예: agym-copy"
          >
            <input
              id="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다."
              className={inputClassName}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </FormField>
        </div>

        <div className="mt-4">
          <span className="text-sm font-medium text-slate-700">공개 상태</span>
          <div className="mt-2 flex gap-3">
            {(["private", "public"] as LandingPageStatus[]).map((value) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium ${
                  status === value
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-300 text-slate-600"
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  value={value}
                  checked={status === value}
                  onChange={() => setStatus(value)}
                  className="sr-only"
                />
                {value === "public" ? "공개" : "비공개"}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            복제 직후에는 업체명/전화/이미지/SEO가 원본 값일 수 있어 기본값은
            비공개입니다. 검수 후 공개로 전환해주세요.
          </p>
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
          {isSubmitting ? "복제 중..." : "복제하기"}
        </button>
      </div>
    </form>
  );
}
