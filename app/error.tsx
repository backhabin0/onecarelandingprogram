"use client";

import { useEffect } from "react";

/**
 * 공개 페이지(app/[slug], app/page.tsx 등) 렌더링 중 예상치 못한 오류가
 * 발생했을 때의 fallback. Supabase 오류/스택 트레이스 등 내부 정보는 절대
 * 사용자 화면에 노출하지 않고, 서버 로그에만 최소한의 진단 정보를 남긴다.
 */
export default function GlobalPublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error] unexpected error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-5 text-center">
      <p className="text-lg font-semibold text-slate-900">
        페이지를 불러오는 중 문제가 발생했습니다.
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
