import { NextResponse } from "next/server";
import writeXlsxFile from "write-excel-file/node";
import { requireUser } from "@/lib/auth";
import { BULK_UPLOAD_TEMPLATE_FILENAME } from "@/lib/bulk-upload/columns";
import { TEMPLATE_COLUMN_WIDTHS, buildTemplateSheet } from "@/lib/bulk-upload/template";

export const dynamic = "force-dynamic";

/** 대량 등록 엑셀 양식 다운로드(첫 줄 머리글 + 예시 1행) */
export async function GET() {
  await requireUser();

  const buffer = await writeXlsxFile(buildTemplateSheet(), {
    sheet: "대량등록",
    columns: TEMPLATE_COLUMN_WIDTHS,
    stickyRowsCount: 1,
  }).toBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${BULK_UPLOAD_TEMPLATE_FILENAME}"`,
      "Cache-Control": "no-store",
    },
  });
}
