import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 사진 파일을 지우기 전에 "아직 쓰는 곳이 있는지" 확인하는 목록.
 * 여기 빠진 칸이 있으면 다른 페이지가 쓰는 사진이 지워진다 — 사진 칸을 새로 만들면 반드시 여기에 넣는다
 * (tests/photos.db.test.ts가 칸마다 삭제가 막히는지 확인한다).
 */
export interface ImageReferenceColumn {
  table: "landing_pages" | "landing_page_seo_settings" | "landing_page_queue" | "site_profile";
  column: string;
  /** count 조회에 쓰는 칸(테이블마다 기본키 이름이 다름) */
  key: string;
  label: string;
  /** 대기열은 공개 전 항목만 본다(공개된 항목은 페이지가 주소를 따로 갖고 있음) */
  unpublishedOnly?: boolean;
}

export const IMAGE_REFERENCE_COLUMNS: readonly ImageReferenceColumn[] = [
  { table: "landing_pages", column: "logo_url", key: "id", label: "페이지 로고" },
  { table: "landing_pages", column: "main_image_url", key: "id", label: "페이지 사진1" },
  { table: "landing_pages", column: "image_2_url", key: "id", label: "페이지 사진2" },
  { table: "landing_pages", column: "image_3_url", key: "id", label: "페이지 사진3" },
  { table: "landing_page_seo_settings", column: "og_image_url", key: "landing_page_id", label: "OG 이미지" },
  { table: "landing_page_queue", column: "main_image_url", key: "id", label: "대기열 사진1", unpublishedOnly: true },
  { table: "landing_page_queue", column: "image_2_url", key: "id", label: "대기열 사진2", unpublishedOnly: true },
  { table: "landing_page_queue", column: "image_3_url", key: "id", label: "대기열 사진3", unpublishedOnly: true },
  { table: "site_profile", column: "logo_url", key: "id", label: "대표 업체 로고" },
];

export interface ImageReferenceResult {
  /** 쓰는 곳 수(칸마다 센 행 수의 합) */
  total: number;
  /** 쓰는 곳이 있는 칸: "페이지 사진2 3곳" 같은 안내용 */
  places: { label: string; count: number }[];
  /** 확인 자체가 실패하면 문구. 이때는 "쓰고 있음"으로 보고 지우지 않는다 */
  error: string | null;
}

/** urls 중 하나라도 쓰는 곳을 모두 센다(보관함 사진은 본 파일 + og 파일 주소를 함께 넘긴다). */
export async function countImageReferences(
  supabase: SupabaseClient,
  urls: readonly string[]
): Promise<ImageReferenceResult> {
  const targets = Array.from(new Set(urls.filter(Boolean)));
  if (targets.length === 0) return { total: 0, places: [], error: null };

  const responses = await Promise.all(
    IMAGE_REFERENCE_COLUMNS.map((ref) => {
      let query = supabase
        .from(ref.table)
        .select(ref.key, { count: "exact", head: true })
        .in(ref.column, targets);
      if (ref.unpublishedOnly) query = query.neq("state", "published");
      return query;
    })
  );

  const failed = responses.find((response) => response.error);
  if (failed?.error) {
    console.error("[storage] reference check failed:", failed.error.message);
    return { total: 0, places: [], error: "사진을 쓰는 곳을 확인하지 못했습니다." };
  }

  const places = IMAGE_REFERENCE_COLUMNS.map((ref, i) => ({ label: ref.label, count: responses[i].count ?? 0 })).filter(
    (place) => place.count > 0
  );
  return { total: places.reduce((sum, place) => sum + place.count, 0), places, error: null };
}

/** "페이지 사진1 3곳, 대표 업체 로고 1곳" */
export function describeImageReferences(places: ImageReferenceResult["places"]): string {
  return places.map((place) => `${place.label} ${place.count}곳`).join(", ");
}
