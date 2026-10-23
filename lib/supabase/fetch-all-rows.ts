import "server-only";

/**
 * PostgREST/Supabase는 한 번의 요청으로 반환하는 row 수에 상한(기본 1,000행,
 * 프로젝트의 max_rows 설정)이 있어서, `.limit(10000)`처럼 더 큰 값을 줘도
 * 조용히 잘린다. 이 크기로 잘라 range(from, to)를 반복 호출해 전체 데이터를
 * 빠짐없이 가져온다. 마지막 페이지의 길이가 이 값보다 작으면 종료한다.
 */
export const SUPABASE_PAGE_SIZE = 1000;

export interface FetchAllRowsResult<T> {
  data: T[];
  error: string | null;
}

type PageQuery = PromiseLike<{
  data: unknown[] | null;
  error: { message: string } | null;
}>;

/**
 * buildPage(from, to)가 매번 새 쿼리를 만들어 `.range(from, to)`까지 적용해
 * 반환하면, 결과가 끝날 때까지 페이지를 이어 붙여 전체 행을 돌려준다.
 *
 * 페이지 사이에 행이 빠지거나 중복되지 않도록 buildPage는 반드시 유일한
 * 정렬 기준(예: created_at + id)을 적용해야 한다.
 *
 * 중간 페이지 조회가 하나라도 실패하면 그때까지 모은 행을 버리고 즉시 실패를
 * 반환한다 — 불완전한 결과를 반환하지 않는다. error에는 Supabase 원본 메시지가
 * 담기므로, 호출부에서 로그를 남기고 사용자용 문구로 바꿔서 쓴다.
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PageQuery
): Promise<FetchAllRowsResult<T>> {
  const rows: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await buildPage(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) {
      return { data: [], error: error.message };
    }

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < SUPABASE_PAGE_SIZE) {
      break;
    }
    from += SUPABASE_PAGE_SIZE;
  }

  return { data: rows, error: null };
}
