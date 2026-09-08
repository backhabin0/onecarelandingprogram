import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { LandingPageSeoSettings, UpdateSeoSettingsInput } from "@/types/seo";

interface GetSeoSettingsResult {
  data: LandingPageSeoSettings | null;
  error: string | null;
}

/**
 * 관리자 화면에서 페이지 1건의 SEO 설정을 조회한다. row가 없으면(한 번도
 * 수동 설정을 저장한 적 없는 페이지) data: null을 반환하고, 호출부는 이를
 * "모든 필드가 자동값"으로 해석한다.
 */
export async function getSeoSettingsByLandingPageId(
  landingPageId: string
): Promise<GetSeoSettingsResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("landing_page_seo_settings")
      .select("*")
      .eq("landing_page_id", landingPageId)
      .maybeSingle();

    if (error) {
      console.error("[landing_page_seo_settings] select error:", error);
      return { data: null, error: "SEO 설정을 불러오지 못했습니다." };
    }

    return { data: (data as LandingPageSeoSettings | null) ?? null, error: null };
  } catch (err) {
    console.error("[landing_page_seo_settings] client error:", err);
    return {
      data: null,
      error:
        err instanceof Error
          ? err.message
          : "SEO 설정을 불러오는 중 오류가 발생했습니다.",
    };
  }
}

export interface UpsertSeoSettingsResult {
  success: boolean;
  error?: string;
}

/**
 * SEO 설정을 저장한다. row가 없으면 새로 만들고(upsert), 있으면 갱신한다.
 * 비어있는 문자열 필드는 null로 저장해 resolver가 자동값을 쓰도록 한다.
 */
export async function upsertSeoSettings(
  landingPageId: string,
  input: UpdateSeoSettingsInput
): Promise<UpsertSeoSettingsResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.from("landing_page_seo_settings").upsert(
      {
        landing_page_id: landingPageId,
        seo_title: input.seoTitle.trim() || null,
        seo_description: input.seoDescription.trim() || null,
        og_title: input.ogTitle.trim() || null,
        og_description: input.ogDescription.trim() || null,
        business_category: input.businessCategory.trim() || null,
        service_area: input.serviceArea.trim() || null,
        seo_noindex: input.seoNoindex,
        disable_auto_faq: input.disableAutoFaq,
      },
      { onConflict: "landing_page_id" }
    );

    if (error) {
      console.error("[landing_page_seo_settings] upsert error:", error);
      return {
        success: false,
        error: "SEO 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_page_seo_settings] client error:", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "SEO 설정을 저장하지 못했습니다.",
    };
  }
}

/**
 * SEO title/description/OG title/description을 자동값으로 되돌린다
 * (해당 컬럼을 null로 만든다). business_category/service_area/noindex/
 * disable_auto_faq처럼 "자동값이 없는" 설정은 건드리지 않는다.
 */
export async function resetSeoOverrides(
  landingPageId: string
): Promise<UpsertSeoSettingsResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.from("landing_page_seo_settings").upsert(
      {
        landing_page_id: landingPageId,
        seo_title: null,
        seo_description: null,
        og_title: null,
        og_description: null,
      },
      { onConflict: "landing_page_id", ignoreDuplicates: false }
    );

    if (error) {
      console.error("[landing_page_seo_settings] reset error:", error);
      return { success: false, error: "자동값으로 되돌리지 못했습니다." };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_page_seo_settings] client error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "자동값으로 되돌리지 못했습니다.",
    };
  }
}

export interface UpdateSeoOgImageResult {
  success: boolean;
  error?: string;
}

/** 전용 OG 이미지 URL만 갱신한다(업로드/삭제 자체는 호출부가 Storage로 처리). */
export async function updateSeoOgImageUrl(
  landingPageId: string,
  url: string | null
): Promise<UpdateSeoOgImageResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.from("landing_page_seo_settings").upsert(
      { landing_page_id: landingPageId, og_image_url: url },
      { onConflict: "landing_page_id" }
    );

    if (error) {
      console.error("[landing_page_seo_settings] og image update error:", error);
      return { success: false, error: "OG 이미지 정보를 저장하지 못했습니다." };
    }

    return { success: true };
  } catch (err) {
    console.error("[landing_page_seo_settings] client error:", err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "OG 이미지 정보를 저장하지 못했습니다.",
    };
  }
}
