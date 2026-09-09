interface AdminLoadingSkeletonProps {
  /** 목록/카드 형태 블록 개수. 화면 성격에 맞게 호출부에서 조절한다. */
  rows?: number;
}

/**
 * 관리자 dynamic route(loading.tsx)에서 공통으로 쓰는 최소한의 skeleton.
 * 새 UI 라이브러리를 추가하지 않고 기존 Tailwind 톤(slate)만 사용한다.
 */
export default function AdminLoadingSkeleton({ rows = 3 }: AdminLoadingSkeletonProps) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}
