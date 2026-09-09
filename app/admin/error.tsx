"use client";

import { useEffect } from "react";

/**
 * /admin 하위 페이지 렌더링 중 예상치 못한 오류가 발생했을 때의 fallback.
 * Supabase 오류 메시지, SQL, 내부 파일 경로 등은 관리자에게도 노출하지
 * 않는다 — 원인 확인은 서버/개발 콘솔 로그로 한다.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin/error] unexpected error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
      <p className="text-base font-semibold text-slate-900">
        작업 중 문제가 발생했습니다.
      </p>
      <p className="text-sm text-slate-500">잠시 후 다시 시도해 주세요.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        다시 시도
      </button>
    </div>
  );
}
