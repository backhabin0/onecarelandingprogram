/**
 * 관리자 목록 검색어를 PostgREST `.or()` 필터 문자열에 넣는 공용 함수(공개 대기열·랜딩페이지 목록).
 */

/** 필터 문법 문자(쉼표, 괄호)를 빼서 검색어가 필터 문자열을 깨뜨리지 않게 한다. */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()]/g, " ").trim();
}

/** 여러 칸 중 하나라도 검색어를 포함하면 맞는 `.or()` 필터. 검색어는 sanitizeSearchTerm을 거친 값 */
export function ilikeAnyFilter(columns: readonly string[], term: string): string {
  return columns.map((column) => `${column}.ilike.%${term}%`).join(",");
}
