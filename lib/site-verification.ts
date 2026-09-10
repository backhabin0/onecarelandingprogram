import "server-only";

import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getGoogleSiteVerification, getNaverSiteVerification } from "@/lib/site";

const SETTINGS_ID = "default";
const MAX_LENGTH = 500;

export interface SiteVerificationField {
  /** DB(관리자 설정)에 저장된 원본 값. 없으면 null. */
  value: string | null;
  /** 실제로 meta 태그에 반영되는 값(DB 우선, 없으면 환경변수, 둘 다 없으면 null). */
  effective: string | null;
  source: "db" | "env" | "none";
}

export interface SiteVerificationSettings {
  google: SiteVerificationField;
  naver: SiteVerificationField;
}

interface SiteVerificationRow {
  google_site_verification: string | null;
  naver_site_verification: string | null;
}

async function fetchSiteVerificationRow(): Promise<SiteVerificationRow | null> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("site_verification_settings")
      .select("google_site_verification, naver_site_verification")
      .eq("id", SETTINGS_ID)
      .maybeSingle();

    if (error) {
      console.error("[site-verification] select error:", error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error(
      "[site-verification] client error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * 같은 요청 안에서 여러 번 호출돼도(예: 루트 레이아웃 + admin/settings 화면)
 * 실제 DB 조회는 한 번만 수행되도록 React cache로 요청 단위 dedupe한다.
 * DB 조회가 실패해도 null을 반환할 뿐 예외를 던지지 않는다 — 호출부가
 * 환경변수 fallback으로 안전하게 계속 동작할 수 있게 하기 위함이다.
 */
const getCachedSiteVerificationRow = cache(fetchSiteVerificationRow);

function buildField(
  dbValue: string | null | undefined,
  envValue: string | undefined
): SiteVerificationField {
  if (dbValue) {
    return { value: dbValue, effective: dbValue, source: "db" };
  }
  if (envValue) {
    return { value: null, effective: envValue, source: "env" };
  }
  return { value: null, effective: null, source: "none" };
}

/**
 * DB 관리자 설정 + 환경변수 fallback을 합쳐 현재 유효한 검색엔진 소유확인
 * 설정을 반환한다. admin/settings 화면(원본 값 + 현재 상태 배지)과
 * 루트 레이아웃 metadata(effective 값)가 모두 이 함수 하나를 사용한다.
 */
export async function getSiteVerificationSettings(): Promise<SiteVerificationSettings> {
  const row = await getCachedSiteVerificationRow();

  return {
    google: buildField(row?.google_site_verification, getGoogleSiteVerification()),
    naver: buildField(row?.naver_site_verification, getNaverSiteVerification()),
  };
}

/** 루트 레이아웃 metadata에 바로 넣을 수 있는 { google, naver } 형태로 축약한다. */
export async function resolveSiteVerification(): Promise<{
  google: string | null;
  naver: string | null;
}> {
  const settings = await getSiteVerificationSettings();
  return {
    google: settings.google.effective,
    naver: settings.naver.effective,
  };
}

export interface SanitizeVerificationResult {
  value: string | null;
  error?: string;
}

/**
 * meta content 값만 저장하도록 하는 입력 검증.
 *
 * - 빈 문자열은 null로 정규화한다(DB 값을 지우면 env fallback으로 돌아간다).
 * - 실수로 전체 <meta ... content="..."> 태그를 붙여넣은 경우, 단순한 정규식
 *   하나로 content 값만 안전하게 추출한다(별도 HTML parser 라이브러리 없이).
 * - 추출 후에도 <, >, 줄바꿈이 남아있거나 500자를 초과하면 거부한다
 *   (metadata injection/XSS 방지 — dangerouslySetInnerHTML을 쓰지 않고
 *   Next Metadata API에 plain string으로만 전달하기 위한 최소 방어선).
 */
export function sanitizeVerificationValue(raw: string): SanitizeVerificationResult {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { value: null };
  }

  const metaTagMatch = /<meta\b[^>]*\bcontent\s*=\s*"([^"]*)"[^>]*>/i.exec(trimmed);
  const candidate = metaTagMatch ? metaTagMatch[1].trim() : trimmed;

  if (/[<>\r\n]/.test(candidate)) {
    return {
      value: null,
      error:
        "전체 meta 태그가 아니라 content 값만 입력해주세요. (예: abc123)",
    };
  }

  if (candidate.length > MAX_LENGTH) {
    return {
      value: null,
      error: `인증값은 ${MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }

  return { value: candidate === "" ? null : candidate };
}

export interface UpdateSiteVerificationInput {
  google: string | null;
  naver: string | null;
}

export interface UpdateSiteVerificationResult {
  success: boolean;
  error?: string;
}

/** requireUser()로 인증을 확인한 Server Action에서만 호출한다. */
export async function updateSiteVerificationSettings(
  input: UpdateSiteVerificationInput
): Promise<UpdateSiteVerificationResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("site_verification_settings")
      .update({
        google_site_verification: input.google,
        naver_site_verification: input.naver,
        updated_at: new Date().toISOString(),
      })
      .eq("id", SETTINGS_ID);

    if (error) {
      console.error("[site-verification] update error:", error.message);
      return { success: false, error: "설정을 저장하지 못했습니다." };
    }

    return { success: true };
  } catch (err) {
    console.error(
      "[site-verification] update client error:",
      err instanceof Error ? err.message : err
    );
    return { success: false, error: "설정을 저장하지 못했습니다." };
  }
}
