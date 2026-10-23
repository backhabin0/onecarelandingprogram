import type { CheckedRowStatus, CheckedUploadRow } from "@/lib/bulk-upload/check";

const STATUS_LABELS: Record<CheckedRowStatus, string> = {
  pass: "통과",
  warning: "경고",
  error: "오류",
};

const STATUS_STYLES: Record<CheckedRowStatus, string> = {
  pass: "bg-green-100 text-green-700",
  warning: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};

const COLUMNS = ["행", "결과", "지역 · 키워드", "URL", "유사도", "내용"];

interface BulkCheckResultTableProps {
  rows: CheckedUploadRow[];
}

/** 대량 등록 검사 결과 표(행 번호별 통과/경고/오류) */
export default function BulkCheckResultTable({ rows }: BulkCheckResultTableProps) {
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-slate-500">해당하는 행이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {COLUMNS.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.rowNumber}
              data-row={row.rowNumber}
              className="border-b border-slate-100 align-top text-slate-700 last:border-0"
            >
              <td className="px-4 py-3 text-slate-500">{row.rowNumber}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                >
                  {STATUS_LABELS[row.status]}
                </span>
                {row.holdable ? (
                  <span className="mt-1 block text-[11px] text-amber-700">보류 저장 가능</span>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <span className="font-medium text-slate-900">{row.queueRow.region || "-"}</span>
                <span className="text-slate-400"> · </span>
                {row.queueRow.keyword || "-"}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">
                {row.queueRow.slug ? `/${row.queueRow.slug}` : "-"}
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {row.similarity ? (
                  <>
                    <span className="font-medium">{Math.floor(row.similarity.score * 100)}%</span>
                    <span className="block text-slate-400">{row.similarity.label}</span>
                  </>
                ) : (
                  "-"
                )}
              </td>
              <td className="px-4 py-3">
                {row.errors.length === 0 && row.warnings.length === 0 ? (
                  <span className="text-slate-400">-</span>
                ) : (
                  <ul className="flex flex-col gap-1 text-xs">
                    {row.errors.map((issue, i) => (
                      <li key={`e${i}`} className="text-red-700">
                        {issue.message}
                      </li>
                    ))}
                    {row.warnings.map((issue, i) => (
                      <li key={`w${i}`} className="text-amber-700">
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
