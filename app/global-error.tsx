"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * app/layout.tsx(루트 레이아웃) 자체가 렌더링에 실패하는, 매우 드문 경우의
 * 최후 방어선. app/error.tsx는 레이아웃이 살아있을 때만 동작하므로, 레이아웃
 * 실패까지 감당하려면 global-error가 자체 <html>/<body>를 그려야 한다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      "[app/global-error] root layout error:",
      error.digest ?? error.message
    );
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-5 text-center">
          <p className="text-lg font-semibold text-slate-900">
            서비스를 불러오는 중 문제가 발생했습니다.
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
      </body>
    </html>
  );
}
