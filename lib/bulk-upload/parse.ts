import { readSheet } from "read-excel-file/universal";
import type { ValidationIssue } from "@/lib/landing-page-validation";
import {
  BULK_UPLOAD_COLUMNS,
  OPTIONAL_UPLOAD_COLUMNS,
  REQUIRED_UPLOAD_HEADERS,
  normalizeHeader,
  type BulkUploadField,
} from "./columns";

/**
 * 대량 등록 파일(xlsx/csv)을 행 목록으로 바꾼다. 브라우저와 테스트(Node)에서
 * 똑같이 동작하도록 DOM·Node 전용 API를 쓰지 않는다.
 */

/** 한 파일에서 받을 수 있는 최대 데이터 행 수(빈 줄 제외) */
export const MAX_UPLOAD_ROWS = 2000;
/** 업로드 파일 최대 크기 */
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;

export type UploadValues = Partial<Record<BulkUploadField, string>>;

export interface UploadRow {
  /** 엑셀/CSV에서 보이는 줄 번호(머리글이 1행) */
  rowNumber: number;
  values: UploadValues;
  /** 파싱하면서 발견한 확인 사항(예: 숫자로 저장된 전화번호) */
  warnings: ValidationIssue[];
}

export interface ParsedUpload {
  rows: UploadRow[];
  /** 하나라도 있으면 파일 전체를 쓸 수 없다 */
  fileErrors: string[];
  /** 양식에 없는 머리글(무시함) */
  ignoredHeaders: string[];
  /** 건너뛴 빈 줄 수 */
  blankRowCount: number;
}

const ALL_COLUMNS = [...BULK_UPLOAD_COLUMNS, ...OPTIONAL_UPLOAD_COLUMNS];
const HEADER_TO_FIELD = new Map(ALL_COLUMNS.map((c) => [normalizeHeader(c.header), c.field]));
const FIELD_LABEL = new Map(ALL_COLUMNS.map((c) => [c.field, c.header]));

// ------------------------------------------------------------
// CSV
// ------------------------------------------------------------

/**
 * CSV 파일 바이트를 문자열로 바꾼다. UTF-8(BOM 포함/미포함)을 먼저 시도하고,
 * UTF-8이 아니면 한국어 Windows 엑셀의 기본 저장 형식인 CP949(EUC-KR)로 읽는다.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    // fatal: 잘못된 UTF-8이면 예외 → EUC-KR로 다시 읽는다. BOM은 기본으로 제거된다.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

/** RFC 4180 CSV 파서: 큰따옴표로 감싼 칸(쉼표·줄바꿈·"" 포함), CRLF/LF 줄바꿈 지원 */
export function parseCsvText(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  // 마지막 줄(끝에 줄바꿈이 없는 경우)
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ------------------------------------------------------------
// 공통: 표 → 행
// ------------------------------------------------------------

function cellToString(value: unknown): { text: string; wasNumber: boolean } {
  if (value === null || value === undefined) return { text: "", wasNumber: false };
  if (typeof value === "string") return { text: value.trim(), wasNumber: false };
  if (typeof value === "number") return { text: String(value), wasNumber: true };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", wasNumber: false };
  if (value instanceof Date) return { text: value.toISOString().slice(0, 10), wasNumber: false };
  return { text: String(value).trim(), wasNumber: false };
}

/**
 * 첫 줄을 머리글로 보고 나머지 줄을 행으로 바꾼다. 모든 칸이 빈 줄은 건너뛴다
 * (줄 번호는 원래 파일 기준을 유지). 필수 머리글이 없거나 중복이면 fileErrors.
 */
export function sheetToUploadRows(
  table: readonly (readonly unknown[])[],
  options: { rowNumberOffset?: number } = {}
): ParsedUpload {
  // 머리글 없이 붙여넣은 표는 양식 머리글을 앞에 붙여 읽으므로, 줄 번호를 한 칸 당겨
  // 사용자가 붙여넣은 줄 번호와 맞춘다(rowNumberOffset = -1).
  const offset = options.rowNumberOffset ?? 0;
  const result: ParsedUpload = { rows: [], fileErrors: [], ignoredHeaders: [], blankRowCount: 0 };

  if (table.length === 0 || table[0].every((cell) => cellToString(cell).text === "")) {
    result.fileErrors.push("첫 줄에 머리글이 없습니다. 양식 파일의 첫 줄을 그대로 두세요.");
    return result;
  }

  const fieldByIndex = new Map<number, BulkUploadField>();
  const seen = new Set<BulkUploadField>();
  table[0].forEach((cell, index) => {
    const header = cellToString(cell).text;
    if (!header) return;
    const field = HEADER_TO_FIELD.get(normalizeHeader(header));
    if (!field) {
      result.ignoredHeaders.push(header);
      return;
    }
    if (seen.has(field)) {
      result.fileErrors.push(`머리글 "${header}"이(가) 두 번 이상 있습니다.`);
      return;
    }
    seen.add(field);
    fieldByIndex.set(index, field);
  });

  const missing = REQUIRED_UPLOAD_HEADERS.filter((field) => !seen.has(field));
  if (missing.length > 0) {
    result.fileErrors.push(
      `필수 머리글이 없습니다: ${missing.map((f) => FIELD_LABEL.get(f)).join(", ")}`
    );
  }
  if (result.fileErrors.length > 0) return result;

  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r];
    const values: UploadValues = {};
    const warnings: ValidationIssue[] = [];
    let hasValue = false;

    for (const [index, field] of fieldByIndex) {
      const { text, wasNumber } = cellToString(cells[index]);
      if (!text) continue;
      hasValue = true;
      values[field] = text;
      if (field === "phone" && wasNumber) {
        warnings.push({
          code: "phone_number_cell",
          fields: ["phone"],
          message:
            "전화번호 칸이 숫자로 저장되어 있어 맨 앞의 0이 빠졌을 수 있습니다. 엑셀에서 텍스트로 입력해주세요.",
        });
      }
    }

    if (!hasValue) {
      result.blankRowCount += 1;
      continue;
    }
    result.rows.push({ rowNumber: r + 1 + offset, values, warnings });
  }

  if (result.rows.length === 0) {
    result.fileErrors.push("머리글 아래에 데이터가 없습니다.");
  } else if (result.rows.length > MAX_UPLOAD_ROWS) {
    result.fileErrors.push(
      `한 번에 최대 ${MAX_UPLOAD_ROWS.toLocaleString()}행까지 올릴 수 있습니다. (현재 ${result.rows.length.toLocaleString()}행) 파일을 나눠서 올려주세요.`
    );
  }

  return result;
}

// ------------------------------------------------------------
// 붙여넣기(AI가 준 표)
// ------------------------------------------------------------

const MARKDOWN_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

/**
 * 붙여넣은 표 텍스트를 칸 목록으로 바꾼다.
 * - 기본은 탭 구분(엑셀·구글 시트에서 복사하거나 AI가 탭으로 준 표)
 * - AI가 지시와 달리 마크다운 표(| a | b |)로 주면 그것도 읽는다(구분선 줄은 건너뜀)
 * - 코드 블록 표시(```) 줄은 건너뛴다
 * 칸 안의 줄바꿈은 지원하지 않는다(한 줄 = 한 행).
 */
export function parsePastedTable(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows: string[][] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) continue;
    if (trimmed.startsWith("|")) {
      if (MARKDOWN_SEPARATOR.test(trimmed)) continue;
      const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
      rows.push(inner.split("|").map((cell) => cell.trim()));
      continue;
    }
    rows.push(line.split("\t"));
  }
  return rows;
}

/** 첫 줄이 머리글인지: 양식 머리글이 3개 이상 들어 있으면 머리글로 본다 */
function looksLikeHeader(row: readonly unknown[]): boolean {
  let matches = 0;
  for (const cell of row) {
    if (typeof cell === "string" && HEADER_TO_FIELD.has(normalizeHeader(cell))) matches += 1;
  }
  return matches >= 3;
}

/**
 * 붙여넣은 표를 행으로 바꾼다. 엑셀 업로드와 같은 규칙(sheetToUploadRows)을 쓴다.
 * 첫 줄이 머리글이 아니면 양식 열 순서 그대로라고 보고 양식 머리글을 붙여 읽는다.
 * 줄 번호는 붙여넣은 텍스트의 줄 번호(마크다운 구분선·코드 블록 줄 제외 후)다.
 */
export function parsePastedUpload(text: string): ParsedUpload {
  const table = parsePastedTable(text);
  // 앞쪽 빈 줄은 머리글 판단 전에 건너뛴다.
  while (table.length > 0 && table[0].every((cell) => cell.trim() === "")) table.shift();

  if (table.length === 0) {
    return { rows: [], fileErrors: ["붙여넣은 내용이 없습니다."], ignoredHeaders: [], blankRowCount: 0 };
  }
  if (looksLikeHeader(table[0])) {
    return sheetToUploadRows(table);
  }
  if (table[0].length > BULK_UPLOAD_COLUMNS.length) {
    return {
      rows: [],
      fileErrors: [
        `머리글이 없고 칸 수(${table[0].length})가 양식(${BULK_UPLOAD_COLUMNS.length}칸)보다 많습니다. 머리글을 포함해 붙여넣어 주세요.`,
      ],
      ignoredHeaders: [],
      blankRowCount: 0,
    };
  }
  return sheetToUploadRows([BULK_UPLOAD_COLUMNS.map((c) => c.header), ...table], { rowNumberOffset: -1 });
}

/** 확장자로 xlsx/csv를 구분해 읽는다. 그 밖의 형식은 fileErrors로 돌려준다. */
export async function parseUploadFile(fileName: string, data: ArrayBuffer): Promise<ParsedUpload> {
  const lower = fileName.toLowerCase();
  const empty: ParsedUpload = { rows: [], fileErrors: [], ignoredHeaders: [], blankRowCount: 0 };

  if (data.byteLength > MAX_UPLOAD_FILE_BYTES) {
    return { ...empty, fileErrors: ["파일 크기가 10MB를 넘습니다."] };
  }

  if (lower.endsWith(".csv")) {
    return sheetToUploadRows(parseCsvText(decodeCsvBytes(new Uint8Array(data))));
  }

  if (lower.endsWith(".xlsx")) {
    try {
      const table = await readSheet(data);
      return sheetToUploadRows(table);
    } catch {
      return { ...empty, fileErrors: ["엑셀 파일을 읽지 못했습니다. 파일이 손상되지 않았는지 확인해주세요."] };
    }
  }

  if (lower.endsWith(".xls")) {
    return {
      ...empty,
      fileErrors: ["예전 엑셀 형식(.xls)은 읽을 수 없습니다. 엑셀에서 .xlsx로 다시 저장해주세요."],
    };
  }

  return { ...empty, fileErrors: ["xlsx 또는 csv 파일만 올릴 수 있습니다."] };
}
