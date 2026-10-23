import type { LandingPageQueueState } from "@/types/publish-queue";

/** 공개 대기열 상태의 화면 표시 이름(서버·클라이언트 공용) */
export const QUEUE_STATE_LABELS: Record<LandingPageQueueState, string> = {
  draft: "초안",
  ready: "공개 대기",
  hold: "보류",
  published: "공개됨",
  failed: "실패",
};

export const QUEUE_STATE_STYLES: Record<LandingPageQueueState, string> = {
  draft: "bg-slate-100 text-slate-600",
  ready: "bg-blue-50 text-blue-700",
  hold: "bg-amber-50 text-amber-700",
  published: "bg-green-100 text-green-700",
  failed: "bg-red-50 text-red-700",
};
