import Link from "next/link";
import type { ConsultationRequestWithLandingPage } from "@/types/consultation-request";
import { getConsultationStatusLabel } from "@/lib/consultation-status";
import { formatDate } from "@/lib/format";

interface ConsultationTableProps {
  consultations: ConsultationRequestWithLandingPage[];
  isFiltered: boolean;
}

const COLUMNS = ["접수일", "랜딩페이지", "이름", "연락처", "문의내용", "상태", "관리"];
const MESSAGE_PREVIEW_LENGTH = 30;

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-slate-100 text-slate-500",
};

function truncateMessage(message: string | null): string {
  if (!message) return "-";
  return message.length > MESSAGE_PREVIEW_LENGTH
    ? `${message.slice(0, MESSAGE_PREVIEW_LENGTH)}...`
    : message;
}

export default function ConsultationTable({
  consultations,
  isFiltered,
}: ConsultationTableProps) {
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
          {consultations.map((item) => (
            <tr
              key={item.id}
              className="border-b border-slate-100 text-slate-700 last:border-0"
            >
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                {formatDate(item.created_at)}
              </td>
              <td className="px-4 py-3">
                {item.landing_page ? (
                  <div>
                    <p className="font-medium text-slate-900">
                      {item.landing_page.business_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      /{item.landing_page.slug}
                    </p>
                  </div>
                ) : (
                  <span className="text-slate-400">삭제된 랜딩페이지</span>
                )}
              </td>
              <td className="px-4 py-3 font-medium text-slate-900">
                {item.name}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                {item.phone}
              </td>
              <td className="max-w-xs px-4 py-3 text-slate-500">
                {truncateMessage(item.message)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[item.status]}`}
                >
                  {getConsultationStatusLabel(item.status)}
                </span>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/consultations/${item.id}`}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  상세보기
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {consultations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-400">
          <p>
            {isFiltered
              ? "조건에 맞는 상담이 없습니다."
              : "접수된 상담이 없습니다."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
