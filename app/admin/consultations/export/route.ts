import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getConsultationRequestsForExport } from "@/lib/consultation-requests";
import {
  getConsultationStatusLabel,
  isConsultationRequestStatus,
} from "@/lib/consultation-status";
import { formatDate } from "@/lib/format";
import type { ConsultationRequestSort } from "@/types/consultation-request";

export const dynamic = "force-dynamic";

const CSV_UTF8_BOM = String.fromCharCode(0xfeff);

// Excel/Google Sheets는 셀 값이 =, +, -, @로 시작하면 수식으로 실행한다.
// 고객이 입력한 name/message나 관리자가 입력한 업체명에 이런 문자로
// 시작하는 값이 있으면 CSV formula injection이 될 수 있으므로, 앞에 한글
// 텍스트 표시를 강제하는 단일 인용부호(')를 붙여 무조건 텍스트로 취급되게 한다.
const FORMULA_TRIGGER_PATTERN = /^[=+\-@]/;

/**
 * 값에 쉼표/줄바꿈/따옴표가 있어도 CSV 컬럼이 깨지지 않도록 escape하고,
 * 수식으로 해석될 수 있는 선행 문자는 먼저 무력화한다.
 */
function escapeCsvField(value: string): string {
  const safeValue = FORMULA_TRIGGER_PATTERN.test(value) ? `'${value}` : value;

  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

/**
 * 전화번호는 Excel이 숫자로 인식해 앞자리 0을 지우는 것을 막기 위해
 * `="010..."` 형태(텍스트 강제 트릭)로 감싼 뒤 CSV escape를 적용한다.
 */
function toCsvPhoneField(value: string): string {
  return `"=""${value.replace(/"/g, '""')}"""`;
}

/**
 * 이 Route Handler는 /admin 하위에 있지만 middleware(proxy.ts)나
 * app/admin/layout.tsx의 인증 보호는 페이지 렌더링에만 적용되므로,
 * 다운로드 API 자체에도 반드시 별도로 관리자 인증을 확인해야 한다.
 * 세션이 없으면 requireUser()가 /login으로 redirect한다.
 */
export async function GET(request: NextRequest) {
  await requireUser();

  const params = request.nextUrl.searchParams;
  const search = params.get("search")?.trim() || undefined;
  const statusParam = params.get("status") ?? "all";
  const status = isConsultationRequestStatus(statusParam) ? statusParam : "all";
  const landingPageId = params.get("landingPageId") || "all";
  const sort: ConsultationRequestSort =
    params.get("sort") === "oldest" ? "oldest" : "newest";

  const { data, error } = await getConsultationRequestsForExport({
    search,
    status,
    landingPageId,
    sort,
  });

  if (error) {
    return new Response("상담 내역을 불러오지 못했습니다.", { status: 500 });
  }

  const header = [
    "접수일",
    "업체명",
    "랜딩페이지 URL",
    "이름",
    "연락처",
    "문의내용",
    "상태",
  ];

  const rows = data.map((item) =>
    [
      escapeCsvField(formatDate(item.created_at)),
      escapeCsvField(item.landing_page?.business_name ?? "삭제된 랜딩페이지"),
      escapeCsvField(item.landing_page ? `/${item.landing_page.slug}` : "-"),
      escapeCsvField(item.name),
      toCsvPhoneField(item.phone),
      escapeCsvField(item.message ?? ""),
      escapeCsvField(getConsultationStatusLabel(item.status)),
    ].join(",")
  );

  // UTF-8 BOM을 붙여 Excel에서 한국어가 깨지지 않게 한다.
  const csvContent =
    CSV_UTF8_BOM + [header.join(","), ...rows].join("\r\n");
  const today = formatDate(new Date().toISOString());

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="consultations-${today}.csv"`,
    },
  });
}
