import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * 네이버 서치어드바이저 수집 요청 완료 표시(018 migration). 공개 대기열 화면의
 * '공개된 주소' 카드에서 주소를 복사하거나 직접 체크하면 저장한다.
 * 페이지 하나에 한 행(landing_page_id)이며, 체크를 풀면 행을 지운다.
 */

const TABLE = "search_submission_checks";

/** `.in()` 한 번에 넣는 id 수(URL 길이 제한) — lib/bulk-upload/context.ts와 같은 기준 */
const IN_CHUNK_SIZE = 100;

/** 주어진 페이지 중 체크된 페이지 id. 018 적용 전(테이블 없음)이면 error와 빈 목록 */
export async function getCheckedLandingPageIds(
  landingPageIds: readonly string[]
): Promise<{ data: Set<string>; error: string | null }> {
  const checked = new Set<string>();
  if (landingPageIds.length === 0) return { data: checked, error: null };

  try {
    const supabase = await getSupabaseServerClient();
    for (let i = 0; i < landingPageIds.length; i += IN_CHUNK_SIZE) {
      const { data, error } = await supabase
        .from(TABLE)
        .select("landing_page_id")
        .in("landing_page_id", landingPageIds.slice(i, i + IN_CHUNK_SIZE));
      if (error) {
        console.error("[search-submission-checks] select error:", error.message);
        return { data: new Set(), error: "수집 요청 완료 표시를 불러오지 못했습니다." };
      }
      for (const row of (data as { landing_page_id: string }[] | null) ?? []) checked.add(row.landing_page_id);
    }
    return { data: checked, error: null };
  } catch (err) {
    console.error("[search-submission-checks] client error:", err instanceof Error ? err.message : err);
    return { data: new Set(), error: "수집 요청 완료 표시를 불러오지 못했습니다." };
  }
}

/**
 * 체크(행 추가) 또는 해제(행 삭제). 이미 같은 상태면 그대로 성공으로 본다
 * (다른 PC에서 먼저 체크한 경우 등). requireUser()로 인증을 확인한 Server Action에서만 호출한다.
 */
export async function setSearchSubmissionCheck(
  landingPageId: string,
  checked: boolean
): Promise<{ success: boolean; error?: string }> {
  const failure = { success: false, error: "수집 요청 완료 표시를 저장하지 못했습니다. 다시 시도해주세요." };
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = checked
      ? await supabase.from(TABLE).insert({ landing_page_id: landingPageId })
      : await supabase.from(TABLE).delete().eq("landing_page_id", landingPageId);

    if (error) {
      // 이미 체크됨(primary key 중복)은 원하는 상태와 같다.
      if (checked && error.code === "23505") return { success: true };
      // 그 사이 페이지가 삭제됨(외래 키 위반)
      if (error.code === "23503") {
        return { success: false, error: "페이지를 찾을 수 없습니다. 목록을 새로고침해주세요." };
      }
      console.error("[search-submission-checks] save error:", error.message);
      return failure;
    }
    return { success: true };
  } catch (err) {
    console.error("[search-submission-checks] client error:", err instanceof Error ? err.message : err);
    return failure;
  }
}
