import type { ConsultationRequestStatus } from "@/types/consultation-request";

export const CONSULTATION_STATUSES: ConsultationRequestStatus[] = [
  "new",
  "contacted",
  "completed",
  "cancelled",
];

const CONSULTATION_STATUS_LABELS: Record<ConsultationRequestStatus, string> = {
  new: "신규",
  contacted: "연락 완료",
  completed: "상담 완료",
  cancelled: "취소",
};

export function getConsultationStatusLabel(
  status: ConsultationRequestStatus
): string {
  return CONSULTATION_STATUS_LABELS[status];
}

export const CONSULTATION_STATUS_OPTIONS = CONSULTATION_STATUSES.map(
  (status) => ({ value: status, label: CONSULTATION_STATUS_LABELS[status] })
);

export function isConsultationRequestStatus(
  value: string
): value is ConsultationRequestStatus {
  return (CONSULTATION_STATUSES as string[]).includes(value);
}
