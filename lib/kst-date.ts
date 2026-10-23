/**
 * 한국 시간(KST, UTC+9, 서머타임 없음) 날짜 계산. "오늘 공개된 주소"처럼 한국 날짜
 * 하루치를 UTC 시각 범위로 바꿀 때 쓴다(공개 함수의 run_date도 한국 날짜 기준).
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" 형식이고 실제로 있는 날짜인지 */
export function isValidDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 주어진 순간의 한국 날짜 "YYYY-MM-DD" */
export function kstDateOf(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 한국 날짜 하루의 UTC 범위 [start, end) — 예: 2026-10-23 → 2026-10-22T15:00Z ~ 2026-10-23T15:00Z */
export function kstDayRange(date: string): { start: string; end: string } {
  if (!isValidDateString(date)) throw new Error(`올바른 날짜가 아닙니다: ${date}`);
  const [y, m, d] = date.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
  };
}
