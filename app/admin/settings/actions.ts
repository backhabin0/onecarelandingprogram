"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  sanitizeVerificationValue,
  updateSiteVerificationSettings,
} from "@/lib/site-verification";

export interface UpdateSiteVerificationActionInput {
  google: string;
  naver: string;
}

export interface UpdateSiteVerificationActionResult {
  success: boolean;
  error?: string;
}

/**
 * 17.5단계: 관리자 검색엔진(Google/Naver) 소유확인 설정 저장.
 * onecarepage.co.kr 전역 설정이므로 landing_page 단위 revalidate가 아니라
 * 루트("/")와 설정 화면만 갱신한다 — 나머지 공개 라우트(/login, /[slug])는
 * 이미 force-dynamic이라 다음 요청부터 자동으로 새 값을 조회한다.
 */
export async function updateSiteVerificationAction(
  input: UpdateSiteVerificationActionInput
): Promise<UpdateSiteVerificationActionResult> {
  await requireUser();

  const google = sanitizeVerificationValue(input.google);
  if (google.error) {
    return { success: false, error: `Google: ${google.error}` };
  }

  const naver = sanitizeVerificationValue(input.naver);
  if (naver.error) {
    return { success: false, error: `네이버: ${naver.error}` };
  }

  const result = await updateSiteVerificationSettings({
    google: google.value,
    naver: naver.value,
  });

  if (result.success) {
    revalidatePath("/");
    revalidatePath("/admin/settings");
  }

  return result;
}
