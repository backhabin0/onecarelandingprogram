import { BULK_UPLOAD_COLUMNS, OPTIONAL_UPLOAD_COLUMNS, type BulkUploadField } from "./columns";
import type { UploadRow, UploadValues } from "./parse";

/**
 * 브라우저 → 서버(Server Action)로 행을 보낼 때 쓰는 도우미.
 * Server Action 요청 본문은 기본 1MB까지라서 크기 기준으로 나눠 보낸다.
 */

/** 한 번에 보내는 요청 본문 목표 크기(1MB 제한에 여유를 둠) */
export const ENQUEUE_CHUNK_MAX_BYTES = 600 * 1024;
/** 한 번에 보내는 최대 행 수 */
export const ENQUEUE_CHUNK_MAX_ROWS = 200;
/** 칸 하나의 최대 글자 수(어떤 규칙의 제한보다도 큼 — 비정상 요청 차단용) */
const MAX_CELL_LENGTH = 5000;

const KNOWN_FIELDS = new Set<string>(
  [...BULK_UPLOAD_COLUMNS, ...OPTIONAL_UPLOAD_COLUMNS].map((c) => c.field)
);

/** 서버로 보내는 행(파싱 경고는 미리보기 전용이라 보내지 않는다) */
export interface UploadRowPayload {
  rowNumber: number;
  values: UploadValues;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** 행 목록을 요청 크기·행 수 제한에 맞춰 나눈다(순서 유지). 행 하나가 제한보다 커도 혼자 한 묶음이 된다. */
export function chunkRowsBySize<T>(
  rows: readonly T[],
  maxBytes = ENQUEUE_CHUNK_MAX_BYTES,
  maxRows = ENQUEUE_CHUNK_MAX_ROWS
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2; // "[]"
  for (const row of rows) {
    const size = byteLength(JSON.stringify(row)) + 1;
    if (current.length > 0 && (currentBytes + size > maxBytes || current.length >= maxRows)) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(row);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function toPayload(rows: readonly UploadRow[]): UploadRowPayload[] {
  return rows.map(({ rowNumber, values }) => ({ rowNumber, values }));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 서버에서 받은 값을 믿지 않고 다시 확인한다. 형식이 틀리면 null.
 * 알려진 칸 이름만 새 객체에 옮겨 담는다(__proto__ 등은 자연히 무시됨).
 */
export function sanitizeUploadPayload(input: unknown, maxRows = ENQUEUE_CHUNK_MAX_ROWS): UploadRow[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > maxRows) return null;

  const rows: UploadRow[] = [];
  const seenRowNumbers = new Set<number>();
  for (const item of input) {
    if (!isRecord(item) || !isRecord(item.values)) return null;
    const rowNumber = item.rowNumber;
    if (typeof rowNumber !== "number" || !Number.isInteger(rowNumber) || rowNumber < 2) return null;
    if (seenRowNumbers.has(rowNumber)) return null;
    seenRowNumbers.add(rowNumber);

    const values = sanitizeUploadValues(item.values);
    if (!values) return null;
    rows.push({ rowNumber, values, warnings: [] });
  }
  return rows;
}

/** 행 하나의 칸 값(알려진 칸, 문자열, 길이 제한)만 옮겨 담는다. 형식이 틀리면 null. */
export function sanitizeUploadValues(input: unknown): UploadValues | null {
  if (!isRecord(input)) return null;
  const values: UploadValues = {};
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_FIELDS.has(key)) continue;
    if (typeof value !== "string" || value.length > MAX_CELL_LENGTH) return null;
    values[key as BulkUploadField] = value;
  }
  return values;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** 문자열 배열(개수·길이 제한)만 받는다. 형식이 틀리면 null. */
export function sanitizeStringList(input: unknown, maxItems: number, maxLength = 200): string[] | null {
  if (!Array.isArray(input) || input.length > maxItems) return null;
  const list: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || item.length > maxLength) return null;
    list.push(item);
  }
  return list;
}
