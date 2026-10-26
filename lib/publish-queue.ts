import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSimilarityThresholds } from "@/lib/bulk-publish-settings";
import {
  SIMILARITY_ERROR_CODE,
  buildUploadSlug,
  checkBulkUploadRows,
  collectPhotoValues,
  issuesForStorage,
} from "@/lib/bulk-upload/check";
import { loadBulkCheckContext } from "@/lib/bulk-upload/context";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { ilikeAnyFilter, sanitizeSearchTerm } from "@/lib/search-term";
import type { UploadValues } from "@/lib/bulk-upload/parse";
import {
  LANDING_PAGE_QUEUE_STATES,
  type LandingPageQueueRow,
  type LandingPageQueueState,
} from "@/types/publish-queue";

/** 공개 대기열 화면 한 페이지 건수 */
export const QUEUE_PAGE_SIZE = 50;

export type QueueStateFilter = LandingPageQueueState | "all";

export function isQueueStateFilter(value: string): value is QueueStateFilter {
  return value === "all" || (LANDING_PAGE_QUEUE_STATES as readonly string[]).includes(value);
}

/** 대기열 검색 대상 칸 */
const QUEUE_SEARCH_COLUMNS = ["region", "keyword", "business_name", "title", "slug"] as const;

export interface GetQueuePageResult {
  data: LandingPageQueueRow[];
  count: number;
  error: string | null;
}

/**
 * 대기열 목록(상태·검색·50개씩). 공개 함수와 같은 순서(오래된 순: created_at, id)로
 * 보여줘서 ready 목록의 위쪽이 먼저 공개될 항목이 되게 한다.
 */
export async function getQueuePage(filter: {
  state: QueueStateFilter;
  search: string;
  page: number;
}): Promise<GetQueuePageResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const page = filter.page > 0 ? filter.page : 1;
    const from = (page - 1) * QUEUE_PAGE_SIZE;
    const to = from + QUEUE_PAGE_SIZE - 1;
    const term = sanitizeSearchTerm(filter.search);

    const build = (head: boolean) => {
      let query = supabase
        .from("landing_page_queue")
        .select(head ? "id" : "*", { count: "exact", head });
      if (filter.state !== "all") query = query.eq("state", filter.state);
      if (term) query = query.or(ilikeAnyFilter(QUEUE_SEARCH_COLUMNS, term));
      return query;
    };

    const { data, error, count } = await build(false)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      // 마지막 페이지를 넘는 page → PostgREST 416(PGRST103). 빈 페이지 + 전체 건수로 처리한다.
      if (error.code === "PGRST103") {
        const { count: total, error: countError } = await build(true);
        if (!countError) return { data: [], count: total ?? 0, error: null };
      }
      console.error("[publish-queue] select page error:", error.message);
      return { data: [], count: 0, error: "공개 대기열을 불러오지 못했습니다." };
    }

    return { data: (data as LandingPageQueueRow[]) ?? [], count: count ?? 0, error: null };
  } catch (err) {
    console.error("[publish-queue] client error:", err instanceof Error ? err.message : err);
    return { data: [], count: 0, error: "공개 대기열을 불러오지 못했습니다." };
  }
}

export type QueueStateCounts = Record<QueueStateFilter, number>;

/** 상태별 건수(탭 숫자) — head count만 조회한다. */
export async function getQueueStateCounts(): Promise<{ data: QueueStateCounts; error: string | null }> {
  const empty = Object.fromEntries(
    (["all", ...LANDING_PAGE_QUEUE_STATES] as QueueStateFilter[]).map((s) => [s, 0])
  ) as QueueStateCounts;

  try {
    const supabase = await getSupabaseServerClient();
    const states: QueueStateFilter[] = ["all", ...LANDING_PAGE_QUEUE_STATES];
    const responses = await Promise.all(
      states.map((state) => {
        const query = supabase.from("landing_page_queue").select("id", { count: "exact", head: true });
        return state === "all" ? query : query.eq("state", state);
      })
    );
    const failed = responses.find((r) => r.error);
    if (failed?.error) {
      console.error("[publish-queue] count error:", failed.error.message);
      return { data: empty, error: "상태별 건수를 불러오지 못했습니다." };
    }
    const data = { ...empty };
    states.forEach((state, i) => {
      data[state] = responses[i].count ?? 0;
    });
    return { data, error: null };
  } catch (err) {
    console.error("[publish-queue] client error:", err instanceof Error ? err.message : err);
    return { data: empty, error: "상태별 건수를 불러오지 못했습니다." };
  }
}

export async function getQueueItem(
  id: string
): Promise<{ data: LandingPageQueueRow | null; error: string | null }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_page_queue")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[publish-queue] select item error:", error.message);
      return { data: null, error: "대기열 항목을 불러오지 못했습니다." };
    }
    return { data: (data as LandingPageQueueRow | null) ?? null, error: null };
  } catch (err) {
    console.error("[publish-queue] client error:", err instanceof Error ? err.message : err);
    return { data: null, error: "대기열 항목을 불러오지 못했습니다." };
  }
}

/** 수정 화면에서 고를 수 있는 상태(공개됨·실패는 직접 고를 수 없음) */
export const EDITABLE_QUEUE_STATES = ["draft", "ready", "hold"] as const;
export type EditableQueueState = (typeof EDITABLE_QUEUE_STATES)[number];

export interface UpdateQueueItemResult {
  success: boolean;
  error?: string;
  /** 검사에서 나온 오류 문구 전체(화면 표시용) */
  errors?: string[];
}

/**
 * 대기열 항목 내용을 고친다. 업로드와 같은 규칙(checkBulkUploadRows)으로
 * 다시 검사하며, 자기 자신은 중복·유사도 비교 대상에서 뺀다.
 * - 이미 공개된 항목은 고칠 수 없다(랜딩페이지 관리에서 직접 수정).
 * - 유사도 외 오류가 있으면 저장하지 않는다.
 * - 유사도 오류가 있으면 ready로는 저장할 수 없다(draft/hold만).
 */
export async function updateQueueItem(
  id: string,
  values: UploadValues,
  state: EditableQueueState
): Promise<UpdateQueueItemResult> {
  const { data: current, error: loadError } = await getQueueItem(id);
  if (loadError) return { success: false, error: loadError };
  if (!current) return { success: false, error: "대기열 항목을 찾을 수 없습니다." };
  if (current.state === "published") {
    return { success: false, error: "이미 공개된 항목은 수정할 수 없습니다. 랜딩페이지 관리에서 수정해주세요." };
  }

  const { thresholds } = await getSimilarityThresholds();
  const { context, error: contextError } = await loadBulkCheckContext({
    slugs: [buildUploadSlug(values)],
    keywords: [values.keyword ?? ""],
    excludeQueueId: id,
    photoValues: collectPhotoValues([{ values }]),
  });
  if (contextError) return { success: false, error: contextError };

  const [row] = checkBulkUploadRows([{ rowNumber: 1, values, warnings: [] }], {
    ...context,
    thresholds,
  }).rows;

  const blocking = row.errors.filter((e) => e.code !== SIMILARITY_ERROR_CODE);
  if (blocking.length > 0) {
    return { success: false, error: "입력값을 확인해주세요.", errors: blocking.map((e) => e.message) };
  }
  if (row.holdable && state === "ready") {
    return {
      success: false,
      error: "문구 유사도가 오류 기준 이상이라 ready로 저장할 수 없습니다. 문구를 고치거나 보류(hold)로 저장해주세요.",
      errors: row.errors.map((e) => e.message),
    };
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_page_queue")
      .update({
        ...row.queueRow,
        state,
        validation_errors: issuesForStorage(row),
      })
      .eq("id", id)
      .neq("state", "published")
      .select("id");

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "이미 사용 중인 URL이거나 같은 지역·키워드가 대기열에 있습니다." };
      }
      console.error("[publish-queue] update error:", error.message);
      return { success: false, error: "저장하지 못했습니다." };
    }
    if (!data || data.length === 0) {
      return { success: false, error: "저장하지 못했습니다. 그 사이 공개되었거나 삭제되었을 수 있습니다." };
    }
    return { success: true };
  } catch (err) {
    console.error("[publish-queue] client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "저장하지 못했습니다." };
  }
}

export interface BulkChangeResult {
  success: boolean;
  /** 실제로 바뀐 행 수 */
  changed: number;
  error?: string;
}

/** 보류(hold) 항목을 ready로 바꾼다. hold가 아닌 항목은 건드리지 않는다. */
export async function releaseHeldItems(ids: string[]): Promise<BulkChangeResult> {
  if (ids.length === 0) return { success: true, changed: 0 };
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_page_queue")
      .update({ state: "ready" })
      .in("id", ids)
      .eq("state", "hold")
      .select("id");
    if (error) {
      console.error("[publish-queue] release error:", error.message);
      return { success: false, changed: 0, error: "상태를 바꾸지 못했습니다." };
    }
    return { success: true, changed: data?.length ?? 0 };
  } catch (err) {
    console.error("[publish-queue] client error:", err instanceof Error ? err.message : err);
    return { success: false, changed: 0, error: "상태를 바꾸지 못했습니다." };
  }
}

/** 대기열 항목을 지운다. 이미 공개된 항목(공개 기록)은 지우지 않는다. */
export async function deleteQueueItems(ids: string[]): Promise<BulkChangeResult> {
  if (ids.length === 0) return { success: true, changed: 0 };
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_page_queue")
      .delete()
      .in("id", ids)
      .neq("state", "published")
      .select("id");
    if (error) {
      console.error("[publish-queue] delete error:", error.message);
      return { success: false, changed: 0, error: "삭제하지 못했습니다." };
    }
    return { success: true, changed: data?.length ?? 0 };
  } catch (err) {
    console.error("[publish-queue] client error:", err instanceof Error ? err.message : err);
    return { success: false, changed: 0, error: "삭제하지 못했습니다." };
  }
}

/**
 * 업체명 일괄 변경 대상: 지금 상태 탭·검색 조건에 맞는 대기열 항목 전부(공개된 항목 제외 —
 * 공개된 페이지는 랜딩페이지 관리에서 바꾼다). 목록과 같은 순서, 1,000행씩 끝까지 읽는다.
 */
export async function getQueueRenameTargets(filter: {
  state: QueueStateFilter;
  search: string;
}): Promise<{ data: { id: string; business_name: string }[]; error: string | null }> {
  try {
    const supabase = await getSupabaseServerClient();
    const term = sanitizeSearchTerm(filter.search);
    const { data, error } = await fetchAllRows<{ id: string; business_name: string }>((from, to) => {
      let query = supabase.from("landing_page_queue").select("id, business_name").neq("state", "published");
      if (filter.state !== "all") query = query.eq("state", filter.state);
      if (term) query = query.or(ilikeAnyFilter(QUEUE_SEARCH_COLUMNS, term));
      return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
    });
    if (error) {
      console.error("[publish-queue] rename targets error:", error);
      return { data: [], error: "대기열 항목을 불러오지 못했습니다." };
    }
    return { data, error: null };
  } catch (err) {
    console.error("[publish-queue] client error:", err instanceof Error ? err.message : err);
    return { data: [], error: "대기열 항목을 불러오지 못했습니다." };
  }
}

/**
 * 대기열 항목 업체명을 한꺼번에 바꾼다(검사는 호출하는 action에서). 이미 공개된 항목과
 * 이미 같은 이름인 항목은 건드리지 않는다. 업체명은 중복·유사도 검사 대상이 아니라
 * validation_errors는 다시 계산하지 않는다.
 */
export async function renameQueueItems(ids: string[], businessName: string): Promise<BulkChangeResult> {
  if (ids.length === 0) return { success: true, changed: 0 };
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_page_queue")
      .update({ business_name: businessName })
      .in("id", ids)
      .neq("state", "published")
      .neq("business_name", businessName)
      .select("id");
    if (error) {
      console.error("[publish-queue] rename error:", error.message);
      return { success: false, changed: 0, error: "업체명을 바꾸지 못했습니다." };
    }
    return { success: true, changed: data?.length ?? 0 };
  } catch (err) {
    console.error("[publish-queue] client error:", err instanceof Error ? err.message : err);
    return { success: false, changed: 0, error: "업체명을 바꾸지 못했습니다." };
  }
}

/** 대기열 행을 수정 폼 값으로 바꾼다(빈 값은 빈 문자열) */
export function queueRowToValues(row: LandingPageQueueRow): UploadValues {
  const faq = (i: number) => row.faqs[i] ?? { question: "", answer: "" };
  return {
    region: row.region,
    keyword: row.keyword,
    regionSlug: row.region_slug,
    keywordSlug: row.keyword_slug,
    slug: row.slug,
    businessName: row.business_name,
    title: row.title,
    heroText: row.hero_text ?? "",
    description: row.description ?? "",
    phone: row.phone ?? "",
    kakaoUrl: row.kakao_url ?? "",
    address: row.address ?? "",
    template: row.template,
    seoTitle: row.seo_title ?? "",
    seoDescription: row.seo_description ?? "",
    faqQuestion1: faq(0).question,
    faqAnswer1: faq(0).answer,
    faqQuestion2: faq(1).question,
    faqAnswer2: faq(1).answer,
    faqQuestion3: faq(2).question,
    faqAnswer3: faq(2).answer,
    city: row.city ?? "",
    citySlug: row.city_slug ?? "",
    mainImageUrl: row.main_image_url ?? "",
    mainImageAlt: row.main_image_alt ?? "",
    caseStudy: row.case_study ?? "",
    image2Url: row.image_2_url ?? "",
    image2Alt: row.image_2_alt ?? "",
    image3Url: row.image_3_url ?? "",
    image3Alt: row.image_3_alt ?? "",
  };
}
