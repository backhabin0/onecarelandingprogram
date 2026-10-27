"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  sanitizeVerificationValue,
  updateSiteVerificationSettings,
} from "@/lib/site-verification";
import { updateSimilarityThresholds } from "@/lib/bulk-publish-settings";
import {
  sanitizeSiteProfileInput,
  updateSiteProfile,
  updateSiteProfileLogo,
  type SiteProfileInput,
} from "@/lib/site-profile";
import { LOCAL_SEO_MAX_LENGTH, isSafeExternalUrl } from "@/lib/landing-page-validation";
import { after } from "next/server";
import { runAutoPublishNow, updateAutoPublishSettings } from "@/lib/auto-publish";
import { submitPendingToIndexNow } from "@/lib/indexnow";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

/**
 * 사이트 대표 업체 정보 저장(017). 공개 홈(/)·/llms.txt·sitemap은 모두 매 요청 조회라
 * 다음 요청부터 바로 반영된다. 랜딩페이지 구조화 데이터도 같은 값을 쓴다.
 */
export async function updateSiteProfileAction(input: SiteProfileInput): Promise<{ success: boolean; error?: string }> {
  await requireUser();

  const sanitized = sanitizeSiteProfileInput({
    businessName: String(input?.businessName ?? ""),
    description: String(input?.description ?? ""),
    phone: String(input?.phone ?? ""),
    kakaoUrl: String(input?.kakaoUrl ?? ""),
  });
  if (!sanitized.ok) return { success: false, error: sanitized.error };

  const result = await updateSiteProfile(sanitized.value);
  if (result.success) {
    revalidatePath("/");
    revalidatePath("/admin/settings");
  }
  return result;
}

/**
 * 019: 대표 업체 로고 저장(사진 보관함에서 고른 주소, 빈 값이면 지움). 페이지 로고가 비어 있고
 * 업체명이 대표 업체와 같은 랜딩페이지도 이 로고를 쓴다(공개 페이지는 매 요청 조회라 바로 반영).
 */
export async function updateSiteProfileLogoAction(logoUrl: unknown): Promise<{ success: boolean; error?: string }> {
  await requireUser();

  if (typeof logoUrl !== "string") return { success: false, error: "잘못된 요청입니다." };
  const url = logoUrl.trim();
  if (url.length > LOCAL_SEO_MAX_LENGTH.mainImageUrl || (url && !isSafeExternalUrl(url))) {
    return { success: false, error: "로고 주소는 http:// 또는 https://로 시작하는 500자 이내 주소여야 합니다." };
  }

  const result = await updateSiteProfileLogo(url || null);
  if (result.success) {
    revalidatePath("/");
    revalidatePath("/admin/settings");
  }
  return result;
}

export interface UpdateSimilarityThresholdsActionResult {
  success: boolean;
  error?: string;
}

/**
 * 4단계: 대량 등록 문장 유사도 기준값(경고/오류) 저장.
 * 0 < 경고 < 오류 ≤ 1 은 lib/bulk-publish-settings.ts와 DB check 제약이 함께 강제한다.
 */
export async function updateSimilarityThresholdsAction(input: {
  warning: unknown;
  error: unknown;
}): Promise<UpdateSimilarityThresholdsActionResult> {
  await requireUser();

  if (typeof input.warning !== "number" || typeof input.error !== "number") {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await updateSimilarityThresholds({
    warning: input.warning,
    error: input.error,
  });

  if (result.success) {
    revalidatePath("/admin/settings");
    revalidatePath("/admin/bulk");
  }

  return result;
}

export interface AutoPublishActionResult {
  success: boolean;
  error?: string;
  message?: string;
}

/** 6단계: 자동 공개 켜기/끄기와 하루 개수(1~100) 저장 */
export async function updateAutoPublishSettingsAction(input: {
  enabled: unknown;
  dailyLimit: unknown;
  noindexThinPages: unknown;
}): Promise<AutoPublishActionResult> {
  await requireUser();

  if (
    typeof input.enabled !== "boolean" ||
    typeof input.dailyLimit !== "number" ||
    typeof input.noindexThinPages !== "boolean"
  ) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await updateAutoPublishSettings({
    enabled: input.enabled,
    dailyLimit: input.dailyLimit,
    noindexThinPages: input.noindexThinPages,
  });
  if (result.success) revalidatePath("/admin/settings");
  return result;
}

/**
 * 6단계: '지금 1회 실행'. 같은 한국 날짜에 이미 실행됐으면 아무것도 하지 않는다.
 * 공개된 페이지가 있으면 응답 뒤에 IndexNow 전송을 시도한다(실패해도 공개에는 영향 없음).
 */
export async function runAutoPublishNowAction(): Promise<AutoPublishActionResult> {
  await requireUser();

  const result = await runAutoPublishNow();
  if (!result.success) {
    return { success: false, error: result.error ?? "공개를 실행하지 못했습니다." };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/queue");
  revalidatePath("/admin");

  if (result.status === "already_ran") {
    return { success: true, message: "오늘(한국 날짜)은 이미 실행했습니다. 내일 다시 실행할 수 있습니다." };
  }

  if ((result.published ?? 0) > 0) {
    after(async () => {
      const supabase = await getSupabaseServerClient();
      await submitPendingToIndexNow({ supabase, trigger: "manual" });
    });
  }

  return {
    success: true,
    message: `공개 ${result.published ?? 0}개, 실패 ${result.failed ?? 0}개${
      (result.published ?? 0) > 0 ? " · 검색엔진 알림(IndexNow)을 보내는 중입니다." : ""
    }`,
  };
}

/** 6단계: IndexNow '지금 보내기'(아직 알리지 않은 공개 페이지) */
export async function sendIndexNowAction(): Promise<AutoPublishActionResult> {
  await requireUser();

  const supabase = await getSupabaseServerClient();
  const result = await submitPendingToIndexNow({ supabase, trigger: "manual" });
  revalidatePath("/admin/settings");

  switch (result.status) {
    case "sent":
      return { success: true, message: `${result.urlCount}개 주소를 보냈습니다. (응답 ${result.statusCode})` };
    case "nothing":
      return { success: true, message: "새로 알릴 공개 페이지가 없습니다." };
    case "not_configured":
      return { success: false, error: result.message };
    case "failed":
      return { success: false, error: `전송 실패: ${result.message ?? "알 수 없는 오류"} (다음에 다시 시도됩니다)` };
    default:
      return { success: false, error: result.message ?? "IndexNow 전송 중 오류가 발생했습니다." };
  }
}
