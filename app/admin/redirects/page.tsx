import PageHeader from "@/components/admin/PageHeader";
import { formatDate } from "@/lib/format";
import { listRedirectsForAdmin, type RedirectPageState } from "@/lib/redirects";

// 이동 목록은 SQL로 바뀌므로 항상 최신 목록을 조회한다.
export const dynamic = "force-dynamic";

const STATE_LABEL: Record<RedirectPageState, string> = {
  public: "공개",
  private: "비공개",
  missing: "없음",
};

/** 301 이동 목록(migration 020) — 확인만 한다. 추가·삭제는 운영 작업(SQL)으로 한다. */
export default async function AdminRedirectsPage() {
  const { data: items, error } = await listRedirectsForAdmin();
  const problemCount = items.filter((item) => item.problem).length;

  return (
    <div>
      <PageHeader
        title="주소 이동"
        description="합쳐진 옛 페이지 주소를 새 주소로 301 이동합니다. 옛 주소는 sitemap·홈·지역 모음·내부 링크에서 빠집니다. 이 화면은 목록 확인용입니다."
      />
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-600">
            이동 <span className="font-semibold text-slate-900">{items.length.toLocaleString("ko-KR")}</span>개
            {problemCount > 0 ? (
              <span className="ml-2 text-amber-700">· 확인 필요 {problemCount.toLocaleString("ko-KR")}개</span>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">이동 목록이 비어 있습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-4 py-3 font-medium">옛 주소</th>
                    <th className="px-4 py-3 font-medium">옛 페이지</th>
                    <th className="px-4 py-3 font-medium">새 주소</th>
                    <th className="px-4 py-3 font-medium">새 페이지</th>
                    <th className="px-4 py-3 font-medium">메모</th>
                    <th className="px-4 py-3 font-medium">등록일</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.fromSlug} className="border-b border-slate-100 text-slate-700 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">/{item.fromSlug}</td>
                      <td className="px-4 py-3 text-slate-500">{STATE_LABEL[item.fromState]}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <a
                          href={`/${item.toSlug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          /{item.toSlug}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        {STATE_LABEL[item.toState]}
                        {item.problem ? <p className="mt-1 text-xs text-amber-700">{item.problem}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{item.note}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
