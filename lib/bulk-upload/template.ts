import type { SheetData } from "write-excel-file/universal";
import { BULK_UPLOAD_COLUMNS } from "./columns";

/**
 * 엑셀 양식(첫 줄 머리글 + 예시 1행). 모든 칸을 텍스트로 만들어 전화번호
 * 앞자리 0이나 긴 숫자가 엑셀에서 바뀌지 않게 한다.
 */
export function buildTemplateSheet(): SheetData {
  const header = BULK_UPLOAD_COLUMNS.map((column) => ({
    value: column.header,
    type: String,
    fontWeight: "bold" as const,
    backgroundColor: "#e2e8f0",
  }));
  const example = BULK_UPLOAD_COLUMNS.map((column) => ({
    value: column.example,
    type: String,
    format: "@",
  }));
  return [header, example];
}

export const TEMPLATE_COLUMN_WIDTHS = BULK_UPLOAD_COLUMNS.map((column) => ({ width: column.width }));
