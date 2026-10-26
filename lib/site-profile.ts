import "server-only";

import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isSafeExternalUrl } from "@/lib/landing-page-validation";

/**
 * 사이트 대표 업체 정보(017 migration, 관리자 설정에서 입력). 공개 홈(/)·/llms.txt·
 * 대표 업체와 같은 이름의 랜딩페이지 구조화 데이터가 이 값을 쓴다.
 *
 * 관리자가 입력한 값만 쓴다 — landing_pages에서 "가장 많이 쓴 전화번호" 같은 값을
 * 추측해서 채우지 않는다(사이트에 여러 업체의 페이지가 섞여 있음).
 */

const PROFILE_ID = "default";

export const SITE_PROFILE_MAX_LENGTH = {
  businessName: 100,
  description: 320,
  phone: 30,
  kakaoUrl: 500,
} as const;

export interface SiteProfile {
  businessName: string | null;
  description: string | null;
  phone: string | null;
  kakaoUrl: string | null;
  /** 019: 대표 업체 로고(사진 보관함 주소). 페이지 로고가 비어 있고 업체명이 같은 페이지도 이 로고를 쓴다 */
  logoUrl: string | null;
  updatedAt: string | null;
}

export const EMPTY_SITE_PROFILE: SiteProfile = {
  businessName: null,
  description: null,
  phone: null,
  kakaoUrl: null,
  logoUrl: null,
  updatedAt: null,
};

interface SiteProfileRow {
  business_name: string | null;
  description: string | null;
  phone: string | null;
  kakao_url: string | null;
  /** 019 적용 전에는 칸이 없다 */
  logo_url?: string | null;
  updated_at: string | null;
}

const orNull = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

async function fetchSiteProfile(): Promise<SiteProfile> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("site_profile")
      // 019(logo_url) 적용 전에도 조회가 실패하지 않도록 칸 이름을 나열하지 않는다.
      .select("*")
      .eq("id", PROFILE_ID)
      .maybeSingle();

    if (error) {
      // 017 적용 전(테이블 없음)이어도 공개 페이지가 죽지 않도록 빈 값으로 둔다.
      console.error("[site-profile] select error:", error.message);
      return EMPTY_SITE_PROFILE;
    }
    const row = data as SiteProfileRow | null;
    if (!row) return EMPTY_SITE_PROFILE;
    return {
      businessName: orNull(row.business_name),
      description: orNull(row.description),
      phone: orNull(row.phone),
      kakaoUrl: orNull(row.kakao_url),
      logoUrl: orNull(row.logo_url),
      updatedAt: row.updated_at ?? null,
    };
  } catch (err) {
    console.error("[site-profile] client error:", err instanceof Error ? err.message : err);
    return EMPTY_SITE_PROFILE;
  }
}

/** 같은 요청 안에서 홈 metadata + 본문이 함께 불러도 DB 조회는 한 번만 한다. */
export const getSiteProfile = cache(fetchSiteProfile);

/** 글자 칸(로고는 따로 저장: updateSiteProfileLogo) */
export type SiteProfileTextValues = Omit<SiteProfile, "updatedAt" | "logoUrl">;

export interface SiteProfileInput {
  businessName: string;
  description: string;
  phone: string;
  kakaoUrl: string;
}

export type SanitizeSiteProfileResult =
  | { ok: true; value: SiteProfileTextValues }
  | { ok: false; error: string };

/** 관리자 입력 검사: 앞뒤 공백 제거, 빈 값은 null, 글자 수·줄바꿈·카카오 URL 형식 */
export function sanitizeSiteProfileInput(input: SiteProfileInput): SanitizeSiteProfileResult {
  const businessName = orNull(input.businessName);
  const description = orNull(input.description?.replace(/\s+/g, " "));
  const phone = orNull(input.phone);
  const kakaoUrl = orNull(input.kakaoUrl);

  const tooLong: [string | null, number, string][] = [
    [businessName, SITE_PROFILE_MAX_LENGTH.businessName, "업체명"],
    [description, SITE_PROFILE_MAX_LENGTH.description, "한 줄 소개"],
    [phone, SITE_PROFILE_MAX_LENGTH.phone, "전화번호"],
    [kakaoUrl, SITE_PROFILE_MAX_LENGTH.kakaoUrl, "카카오톡 URL"],
  ];
  for (const [value, max, label] of tooLong) {
    if (value && value.length > max) return { ok: false, error: `${label}은(는) ${max}자 이내로 입력해주세요.` };
  }
  if ((businessName && /[\r\n<>]/.test(businessName)) || (phone && /[\r\n<>]/.test(phone))) {
    return { ok: false, error: "업체명·전화번호에는 줄바꿈이나 < > 기호를 쓸 수 없습니다." };
  }
  if (phone && !/^[0-9+\-().\s]+$/.test(phone)) {
    return { ok: false, error: "전화번호는 숫자와 - ( ) + 기호만 입력해주세요." };
  }
  if (kakaoUrl && !isSafeExternalUrl(kakaoUrl)) {
    return { ok: false, error: "카카오톡 URL은 http:// 또는 https://로 시작해야 합니다." };
  }
  return { ok: true, value: { businessName, description, phone, kakaoUrl } };
}

/** requireUser()로 인증을 확인한 Server Action에서만 호출한다. */
export async function updateSiteProfile(
  value: SiteProfileTextValues
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("site_profile")
      .update({
        business_name: value.businessName,
        description: value.description,
        phone: value.phone,
        kakao_url: value.kakaoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", PROFILE_ID);

    if (error) {
      console.error("[site-profile] update error:", error.message);
      return { success: false, error: "대표 업체 정보를 저장하지 못했습니다." };
    }
    return { success: true };
  } catch (err) {
    console.error("[site-profile] update client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "대표 업체 정보를 저장하지 못했습니다." };
  }
}

/**
 * 019: 대표 업체 로고 저장(빈 값이면 null). 주소 형식은 호출하는 action이 검사한다.
 * requireUser()로 인증을 확인한 Server Action에서만 호출한다.
 */
export async function updateSiteProfileLogo(logoUrl: string | null): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("site_profile")
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq("id", PROFILE_ID);
    if (error) {
      console.error("[site-profile] update logo error:", error.message);
      return { success: false, error: "대표 업체 로고를 저장하지 못했습니다." };
    }
    return { success: true };
  } catch (err) {
    console.error("[site-profile] update logo client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "대표 업체 로고를 저장하지 못했습니다." };
  }
}
