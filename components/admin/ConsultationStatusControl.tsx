"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConsultationRequestStatus } from "@/types/consultation-request";
import { CONSULTATION_STATUS_OPTIONS } from "@/lib/consultation-status";
import { updateConsultationStatusAction } from "@/app/admin/consultations/actions";

interface ConsultationStatusControlProps {
  id: string;
  status: ConsultationRequestStatus;
}

export default function ConsultationStatusControl({
  id,
  status,
}: ConsultationStatusControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<ConsultationRequestStatus>(status);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleChange = (next: string) => {
    if (isPending) return;

    const previous = selected;
    setSelected(next as ConsultationRequestStatus);
    setErrorMessage(null);

    startTransition(async () => {
      const result = await updateConsultationStatusAction(id, next);

      if (!result.success) {
        setErrorMessage(result.error ?? "상담 상태를 변경하지 못했습니다.");
        setSelected(previous);
        return;
      }

      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={selected}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {CONSULTATION_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {isPending ? (
        <span className="text-xs text-slate-400">변경 중...</span>
      ) : null}
      {errorMessage ? (
        <span className="text-xs text-red-600">{errorMessage}</span>
      ) : null}
    </div>
  );
}
