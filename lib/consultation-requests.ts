import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ConsultationRequestFilters,
  ConsultationRequestStatus,
  ConsultationRequestWithLandingPage,
  InsertConsultationRequestInput,
} from "@/types/consultation-request";

const CONSULTATION_SELECT_WITH_LANDING_PAGE =
  "*, landing_page:landing_pages(business_name, slug)";

/** 관리자 목록 화면의 한 페이지에 보여줄 건수 */
export const CONSULTATION_REQUESTS_PAGE_SIZE = 20;

/** CSV/Excel 내보내기에서 한 번에 가져올 수 있는 최대 건수(안전장치) */
const CONSULTATION_EXPORT_MAX_ROWS = 5000;

/**
 * 이름/연락처 검색어를 PostgREST `.or()` 필터 문자열에 안전하게 넣기 위해
 * 필터 문법에서 의미를 갖는 문자(쉼표, 괄호)를 제거한다.
 */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()]/g, " ").trim();
}

export interface InsertConsultationRequestResult {
  success: boolean;
  error?: string;
}

/**
 * 상담 신청 1건을 저장한다.
 *
 * 호출부(Server Action)가 이미 입력값 검증과 "이 landing_page가 실제로
 * public 상태인지" 확인을 마쳤다고 가정한다 — 이 함수는 DB INSERT만 담당한다.
 * status는 항상 DB 기본값('new')으로 저장되고, privacy_consent는 호출부에서
 * 이미 true임을 확인한 값만 전달된다는 전제로 저장한다.
 */
export async function insertConsultationRequest(
  input: InsertConsultationRequestInput
): Promise<InsertConsultationRequestResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.from("consultation_requests").insert({
      landing_page_id: input.landingPageId,
      name: input.name,
      phone: input.phone,
      message: input.message,
      privacy_consent: true,
    });

    if (error) {
      console.error("[consultation_requests] insert error:", error);
      return {
        success: false,
        error: "상담 신청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[consultation_requests] client error:", err);
    return {
      success: false,
      error: "상담 신청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
}

export interface GetConsultationRequestsResult {
  data: ConsultationRequestWithLandingPage[];
  count: number;
  error: string | null;
}

/**
 * 관리자 상담 목록 조회. 검색/상태/랜딩페이지 필터와 정렬, 페이지네이션을 지원한다.
 * authenticated(관리자) RLS 정책(007 migration)이 있어야 SELECT가 허용된다.
 */
export async function getConsultationRequests(
  filters: ConsultationRequestFilters
): Promise<GetConsultationRequestsResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const from = (page - 1) * CONSULTATION_REQUESTS_PAGE_SIZE;
    const to = from + CONSULTATION_REQUESTS_PAGE_SIZE - 1;

    let query = supabase
      .from("consultation_requests")
      .select(CONSULTATION_SELECT_WITH_LANDING_PAGE, { count: "exact" });

    const search = filters.search?.trim();
    if (search) {
      const term = sanitizeSearchTerm(search);
      if (term) {
        query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
      }
    }

    if (filters.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (filters.landingPageId && filters.landingPageId !== "all") {
      query =
        filters.landingPageId === "deleted"
          ? query.is("landing_page_id", null)
          : query.eq("landing_page_id", filters.landingPageId);
    }

    query = query
      .order("created_at", { ascending: filters.sort === "oldest" })
      .range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error("[consultation_requests] select error:", error);
      return { data: [], count: 0, error: "상담 내역을 불러오지 못했습니다." };
    }

    return {
      data: (data as unknown as ConsultationRequestWithLandingPage[]) ?? [],
      count: count ?? 0,
      error: null,
    };
  } catch (err) {
    console.error("[consultation_requests] client error:", err);
    return { data: [], count: 0, error: "상담 내역을 불러오지 못했습니다." };
  }
}

export interface GetConsultationRequestsForExportResult {
  data: ConsultationRequestWithLandingPage[];
  error: string | null;
}

/**
 * CSV/Excel 내보내기용 조회. 페이지네이션 없이 현재 검색/필터 조건에 맞는
 * 전체 결과를(최대 CONSULTATION_EXPORT_MAX_ROWS건까지) 가져온다.
 */
export async function getConsultationRequestsForExport(
  filters: Omit<ConsultationRequestFilters, "page">
): Promise<GetConsultationRequestsForExportResult> {
  try {
    const supabase = await getSupabaseServerClient();

    let query = supabase
      .from("consultation_requests")
      .select(CONSULTATION_SELECT_WITH_LANDING_PAGE);

    const search = filters.search?.trim();
    if (search) {
      const term = sanitizeSearchTerm(search);
      if (term) {
        query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
      }
    }

    if (filters.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (filters.landingPageId && filters.landingPageId !== "all") {
      query =
        filters.landingPageId === "deleted"
          ? query.is("landing_page_id", null)
          : query.eq("landing_page_id", filters.landingPageId);
    }

    query = query
      .order("created_at", { ascending: filters.sort === "oldest" })
      .range(0, CONSULTATION_EXPORT_MAX_ROWS - 1);

    const { data, error } = await query;

    if (error) {
      console.error("[consultation_requests] export select error:", error);
      return { data: [], error: "상담 내역을 불러오지 못했습니다." };
    }

    return {
      data: (data as unknown as ConsultationRequestWithLandingPage[]) ?? [],
      error: null,
    };
  } catch (err) {
    console.error("[consultation_requests] client error:", err);
    return { data: [], error: "상담 내역을 불러오지 못했습니다." };
  }
}

export interface GetConsultationRequestByIdResult {
  data: ConsultationRequestWithLandingPage | null;
  error: string | null;
}

export async function getConsultationRequestById(
  id: string
): Promise<GetConsultationRequestByIdResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("consultation_requests")
      .select(CONSULTATION_SELECT_WITH_LANDING_PAGE)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[consultation_requests] select by id error:", error);
      return { data: null, error: "상담 내역을 불러오지 못했습니다." };
    }

    return {
      data: (data as unknown as ConsultationRequestWithLandingPage | null) ?? null,
      error: null,
    };
  } catch (err) {
    console.error("[consultation_requests] client error:", err);
    return { data: null, error: "상담 내역을 불러오지 못했습니다." };
  }
}

export interface UpdateConsultationRequestStatusResult {
  success: boolean;
  error?: string;
}

export async function updateConsultationRequestStatus(
  id: string,
  status: ConsultationRequestStatus
): Promise<UpdateConsultationRequestStatusResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("consultation_requests")
      .update({ status })
      .eq("id", id);

    if (error) {
      console.error("[consultation_requests] update status error:", error);
      return { success: false, error: "상담 상태를 변경하지 못했습니다." };
    }

    return { success: true };
  } catch (err) {
    console.error("[consultation_requests] client error:", err);
    return { success: false, error: "상담 상태를 변경하지 못했습니다." };
  }
}
