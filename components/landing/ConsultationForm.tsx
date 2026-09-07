"use client";

import { useState, type FormEvent } from "react";
import PrivacyConsent from "@/components/landing/PrivacyConsent";
import { createConsultationRequestAction } from "@/app/[slug]/actions";

const NAME_MAX_LENGTH = 50;
const MESSAGE_MAX_LENGTH = 1000;

interface ConsultationFormProps {
  slug: string;
  variant?: "light" | "dark";
}

const EMPTY_VALUES = {
  name: "",
  phone: "",
  message: "",
  website: "",
};

export default function ConsultationForm({
  slug,
  variant = "light",
}: ConsultationFormProps) {
  const [values, setValues] = useState(EMPTY_VALUES);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isDark = variant === "dark";
  const inputClassName = isDark
    ? "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2.5 text-base text-white placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
    : "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClassName = `text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`;
  const buttonClassName = isDark
    ? `mt-1 min-h-12 rounded-lg px-6 text-base font-semibold text-white sm:min-h-14 sm:text-lg ${
        isSubmitting
          ? "cursor-not-allowed bg-orange-500/60"
          : "bg-orange-500 active:bg-orange-600"
      }`
    : `mt-1 min-h-12 rounded-lg px-6 text-base font-semibold text-white sm:min-h-14 sm:text-lg ${
        isSubmitting
          ? "cursor-not-allowed bg-blue-400"
          : "bg-blue-600 active:bg-blue-700"
      }`;

  const updateField = (field: keyof typeof EMPTY_VALUES, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    const result = await createConsultationRequestAction({
      slug,
      name: values.name,
      phone: values.phone,
      message: values.message,
      privacyConsent,
      website: values.website,
    });

    if (!result.success) {
      setErrorMessage(result.error ?? "상담 신청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
      setIsSubmitting(false);
      return;
    }

    setValues(EMPTY_VALUES);
    setPrivacyConsent(false);
    setSuccessMessage("상담 신청이 완료되었습니다.");
    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {/* Honeypot: 정상 사용자에게는 보이지 않아야 하는 스팸 방지용 필드 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor={`website-${slug}`}>웹사이트</label>
        <input
          id={`website-${slug}`}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => updateField("website", e.target.value)}
        />
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div
          role="status"
          className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {successMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`name-${slug}`} className={labelClassName}>
          이름
        </label>
        <input
          id={`name-${slug}`}
          required
          maxLength={NAME_MAX_LENGTH}
          autoComplete="name"
          className={inputClassName}
          placeholder="이름을 입력해주세요"
          value={values.name}
          onChange={(e) => updateField("name", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`phone-${slug}`} className={labelClassName}>
          연락처
        </label>
        <input
          id={`phone-${slug}`}
          type="tel"
          required
          autoComplete="tel"
          className={inputClassName}
          placeholder="010-1234-5678"
          value={values.phone}
          onChange={(e) => updateField("phone", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`message-${slug}`} className={labelClassName}>
          문의내용 <span className="font-normal">(선택)</span>
        </label>
        <textarea
          id={`message-${slug}`}
          rows={4}
          maxLength={MESSAGE_MAX_LENGTH}
          className={inputClassName}
          placeholder="문의하실 내용을 입력해주세요"
          value={values.message}
          onChange={(e) => updateField("message", e.target.value)}
        />
      </div>

      <PrivacyConsent
        id={`privacy-consent-${slug}`}
        checked={privacyConsent}
        onChange={setPrivacyConsent}
        variant={variant}
      />

      <button type="submit" disabled={isSubmitting} className={buttonClassName}>
        {isSubmitting ? "상담 신청 중..." : "상담 신청하기"}
      </button>
    </form>
  );
}
