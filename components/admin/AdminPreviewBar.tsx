import Link from "next/link";
import type { LandingPage } from "@/types/landing-page";
import StatusBadge from "@/components/admin/StatusBadge";
import { getAbsoluteUrl } from "@/lib/site";

interface AdminPreviewBarProps {
  landingPage: LandingPage;
}

/**
 * 관리자 미리보기 화면 상단에만 붙는 chrome. 실제 공개 페이지(app/[slug])에는
 * 이 컴포넌트를 절대 포함하지 않는다 — TemplateA/TemplateB 자체에는 관리자 UI를
 * 하드코딩하지 않고, 이 bar는 app/admin/pages/[id]/preview/page.tsx에서만 사용한다.
 */
export default function AdminPreviewBar({ landingPage }: AdminPreviewBarProps) {
  const isPublic = landingPage.status === "public";

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">관리자 미리보기</span>
        <StatusBadge status={landingPage.status} />
        <span className="text-slate-300">{landingPage.business_name}</span>
        <span className="text-slate-500">/{landingPage.slug}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isPublic ? (
          <a
            href={getAbsoluteUrl(`/${landingPage.slug}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800"
          >
            실제 공개 페이지 열기
          </a>
        ) : (
          <span className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400">
            현재 비공개 페이지입니다.
          </span>
        )}
        <Link
          href={`/admin/pages/${landingPage.id}/edit`}
          className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-800"
        >
          수정하기
        </Link>
        <Link
          href="/admin/pages"
          className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-white"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
