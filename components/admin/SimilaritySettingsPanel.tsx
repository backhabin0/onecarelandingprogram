"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/admin/Card";
import FormField from "@/components/admin/FormField";
import { updateSimilarityThresholdsAction } from "@/app/admin/settings/actions";
import { isValidSimilarityThresholds, type SimilarityThresholds } from "@/lib/bulk-upload/similarity";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

interface SimilaritySettingsPanelProps {
  initialThresholds: SimilarityThresholds;
  loadError: string | null;
}

/** 대량 등록 문장 유사도 기준값(경고/오류) 설정 */
export default function SimilaritySettingsPanel({ initialThresholds, loadError }: SimilaritySettingsPanelProps) {
  const router = useRouter();
  const [warning, setWarning] = useState(String(initialThresholds.warning));
  const [error, setError] = useState(String(initialThresholds.error));
  const [isSaving, startSaving] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const thresholds = { warning: Number(warning), error: Number(error) };
    if (!isValidSimilarityThresholds(thresholds)) {
      setMessage({
        type: "error",
        text: "기준값은 0보다 크고 1 이하이며, 경고 기준이 오류 기준보다 작아야 합니다.",
      });
      return;
    }
    setMessage(null);
    startSaving(async () => {
      const result = await updateSimilarityThresholdsAction(thresholds);
      if (!result.success) {
        setMessage({ type: "error", text: result.error ?? "저장하지 못했습니다." });
        return;
      }
      setMessage({ type: "success", text: "저장했습니다." });
      router.refresh();
    });
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">대량 등록 문장 유사도 기준</h2>
      <p className="mt-1 text-sm text-slate-500">
        대량 등록 시 대표 문구+소개 문구를 같은 키워드의 기존 페이지·대기열과 비교합니다(0~1, 1이면
        똑같은 문구). 경고 기준 이상이면 경고, 오류 기준 이상이면 오류로 표시합니다.
      </p>
      {loadError ? <p className="mt-2 text-xs text-amber-700">{loadError}</p> : null}
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="경고 기준" htmlFor="similarityWarning" hint="기본값 0.6">
            <input
              id="similarityWarning"
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              className={inputClassName}
              value={warning}
              onChange={(e) => setWarning(e.target.value)}
            />
          </FormField>
          <FormField label="오류 기준" htmlFor="similarityError" hint="기본값 0.8">
            <input
              id="similarityError"
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              className={inputClassName}
              value={error}
              onChange={(e) => setError(e.target.value)}
            />
          </FormField>
        </div>
        {message ? (
          <p className={`text-sm ${message.type === "error" ? "text-red-600" : "text-green-700"}`}>{message.text}</p>
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
      </form>
    </Card>
  );
}
