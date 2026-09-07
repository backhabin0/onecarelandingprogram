import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { InsertConsultationRequestInput } from "@/types/consultation-request";

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
