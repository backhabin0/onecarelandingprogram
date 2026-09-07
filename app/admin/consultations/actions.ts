"use server";

import { revalidatePath } from "next/cache";
import { updateConsultationRequestStatus } from "@/lib/consultation-requests";
import { isConsultationRequestStatus } from "@/lib/consultation-status";

export interface UpdateConsultationStatusResult {
  success: boolean;
  error?: string;
}

/**
 * 관리자가 상담 상태를 변경할 때 호출하는 Server Action.
 * 클라이언트가 보낸 status 문자열을 그대로 DB에 넣지 않고 허용된 값인지
 * 다시 검증한다. 실제 쓰기 권한 자체는 007 migration의 authenticated UPDATE
 * RLS 정책이 최종적으로 보장한다.
 */
export async function updateConsultationStatusAction(
  id: string,
  status: string
): Promise<UpdateConsultationStatusResult> {
  if (!id) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  if (!isConsultationRequestStatus(status)) {
    return { success: false, error: "잘못된 상태 값입니다." };
  }

  const result = await updateConsultationRequestStatus(id, status);

  if (result.success) {
    revalidatePath("/admin/consultations");
    revalidatePath(`/admin/consultations/${id}`);
  }

  return result;
}
