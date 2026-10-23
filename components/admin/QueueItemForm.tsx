"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import { updateQueueItemAction } from "@/app/admin/queue/actions";
import type { BulkUploadField } from "@/lib/bulk-upload/columns";
import type { UploadValues } from "@/lib/bulk-upload/parse";
import { FAQ_MAX_LENGTH, LANDING_PAGE_MAX_LENGTH, SEO_MAX_LENGTH } from "@/lib/landing-page-validation";
import { mockTemplates } from "@/lib/mock-data";
import { QUEUE_STATE_LABELS } from "@/lib/publish-queue-labels";
import type { LandingPageQueueState } from "@/types/publish-queue";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

/** 수정 화면에서 고를 수 있는 상태(lib/publish-queue.ts의 EDITABLE_QUEUE_STATES와 같음) */
const STATE_OPTIONS = ["ready", "hold", "draft"] as const;
type EditableState = (typeof STATE_OPTIONS)[number];

interface QueueItemFormProps {
  id: string;
  initialValues: UploadValues;
  currentState: LandingPageQueueState;
}

interface TextField {
  field: BulkUploadField;
  label: string;
  maxLength?: number;
  hint?: string;
  multiline?: boolean;
}

const BASIC_FIELDS: TextField[] = [
  { field: "region", label: "지역 *" },
  { field: "keyword", label: "키워드 *" },
  { field: "regionSlug", label: "region_slug *" },
  { field: "keywordSlug", label: "keyword_slug *" },
  { field: "slug", label: "URL Slug", hint: "비우면 region_slug-keyword_slug로 만듭니다." },
  { field: "businessName", label: "업체명 *", maxLength: LANDING_PAGE_MAX_LENGTH.businessName },
  { field: "title", label: "페이지 제목 *", maxLength: LANDING_PAGE_MAX_LENGTH.title },
  { field: "heroText", label: "대표 문구", maxLength: LANDING_PAGE_MAX_LENGTH.heroText },
  { field: "description", label: "소개 문구", maxLength: LANDING_PAGE_MAX_LENGTH.description, multiline: true },
  { field: "phone", label: "전화", maxLength: LANDING_PAGE_MAX_LENGTH.phone },
  { field: "kakaoUrl", label: "카카오 URL", maxLength: LANDING_PAGE_MAX_LENGTH.kakaoUrl },
  { field: "address", label: "주소", maxLength: LANDING_PAGE_MAX_LENGTH.address },
  { field: "seoTitle", label: "SEO 제목", maxLength: SEO_MAX_LENGTH.title },
  { field: "seoDescription", label: "SEO 설명", maxLength: SEO_MAX_LENGTH.description, multiline: true },
];

const FAQ_FIELDS = [1, 2, 3] as const;

export default function QueueItemForm({ id, initialValues, currentState }: QueueItemFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<UploadValues>(initialValues);
  const [state, setState] = useState<EditableState>(
    (STATE_OPTIONS as readonly string[]).includes(currentState) ? (currentState as EditableState) : "ready"
  );
  const [isSaving, startSaving] = useTransition();
  const [result, setResult] = useState<{ type: "success" | "error"; text: string; details?: string[] } | null>(
    null
  );

  const set = (field: BulkUploadField, value: string) => setValues((current) => ({ ...current, [field]: value }));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setResult(null);
    startSaving(async () => {
      const response = await updateQueueItemAction(id, values, state);
      if (!response.success) {
        setResult({ type: "error", text: response.error ?? "저장하지 못했습니다.", details: response.errors });
        return;
      }
      setResult({ type: "success", text: "저장했습니다." });
      router.refresh();
    });
  };

  const renderInput = ({ field, label, maxLength, hint, multiline }: TextField) => {
    const inputId = `queue-${field}`;
    return (
      <FormField key={field} label={label} htmlFor={inputId} hint={hint}>
        {multiline ? (
          <textarea
            id={inputId}
            className={`${inputClassName} min-h-24`}
            value={values[field] ?? ""}
            maxLength={maxLength}
            onChange={(e) => set(field, e.target.value)}
          />
        ) : (
          <input
            id={inputId}
            className={inputClassName}
            value={values[field] ?? ""}
            maxLength={maxLength}
            onChange={(e) => set(field, e.target.value)}
          />
        )}
      </FormField>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {currentState === "failed" ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          공개에 실패한 항목입니다. 내용을 고친 뒤 상태를 정해 저장하면 다시 공개 대상이 됩니다.
        </p>
      ) : null}

      <Card className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
        {BASIC_FIELDS.map(renderInput)}
        <FormField label="템플릿" htmlFor="queue-template">
          <select
            id="queue-template"
            className={inputClassName}
            value={values.template ?? ""}
            onChange={(e) => set("template", e.target.value)}
          >
            {mockTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} ({template.id})
              </option>
            ))}
          </select>
        </FormField>
      </Card>

      <Card className="grid grid-cols-1 gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900">FAQ</h2>
        {FAQ_FIELDS.map((k) =>
          [
            renderInput({ field: `faqQuestion${k}`, label: `질문 ${k}`, maxLength: FAQ_MAX_LENGTH.question }),
            renderInput({ field: `faqAnswer${k}`, label: `답변 ${k}`, maxLength: FAQ_MAX_LENGTH.answer, multiline: true }),
          ]
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <FormField label="저장할 상태" htmlFor="queue-state" hint="공개 대기(ready)만 자동 공개 대상이 됩니다.">
          <select
            id="queue-state"
            className={inputClassName}
            value={state}
            onChange={(e) => setState(e.target.value as EditableState)}
          >
            {STATE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {QUEUE_STATE_LABELS[option]}
              </option>
            ))}
          </select>
        </FormField>

        {result ? (
          <div
            className={`rounded-md border px-4 py-3 text-sm ${
              result.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            <p>{result.text}</p>
            {result.details && result.details.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {result.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSaving}
          className={`w-fit rounded-md px-5 py-2.5 text-sm font-medium text-white ${
            isSaving ? "cursor-not-allowed bg-slate-400" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {isSaving ? "저장 중..." : "저장"}
        </button>
      </Card>
    </form>
  );
}
