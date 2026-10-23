import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEFAULT_SIMILARITY_THRESHOLDS,
  isValidSimilarityThresholds,
  type SimilarityThresholds,
} from "@/lib/bulk-upload/similarity";

const SETTINGS_ID = "default";

export interface GetSimilarityThresholdsResult {
  thresholds: SimilarityThresholds;
  /** 조회에 실패해 기본값을 돌려준 경우 사용자용 문구 */
  error: string | null;
}

/**
 * 대량 등록 유사도 기준값(auto_publish_settings, 014 migration).
 * 조회에 실패하면 기본값(0.6 / 0.8)을 돌려주고 error를 채운다 — 화면이 깨지지
 * 않게 하되, 호출부가 "기본값으로 검사 중"이라고 알릴 수 있게 한다.
 */
export async function getSimilarityThresholds(): Promise<GetSimilarityThresholdsResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("auto_publish_settings")
      .select("similarity_warning_threshold, similarity_error_threshold")
      .eq("id", SETTINGS_ID)
      .maybeSingle();

    if (error || !data) {
      if (error) console.error("[bulk-publish-settings] select error:", error.message);
      return {
        thresholds: DEFAULT_SIMILARITY_THRESHOLDS,
        error: "유사도 기준값을 불러오지 못해 기본값(경고 0.6 / 오류 0.8)을 사용합니다.",
      };
    }

    const thresholds = {
      warning: Number(data.similarity_warning_threshold),
      error: Number(data.similarity_error_threshold),
    };
    if (!isValidSimilarityThresholds(thresholds)) {
      return {
        thresholds: DEFAULT_SIMILARITY_THRESHOLDS,
        error: "저장된 유사도 기준값이 올바르지 않아 기본값을 사용합니다.",
      };
    }
    return { thresholds, error: null };
  } catch (err) {
    console.error("[bulk-publish-settings] client error:", err instanceof Error ? err.message : err);
    return {
      thresholds: DEFAULT_SIMILARITY_THRESHOLDS,
      error: "유사도 기준값을 불러오지 못해 기본값(경고 0.6 / 오류 0.8)을 사용합니다.",
    };
  }
}

export interface UpdateSimilarityThresholdsResult {
  success: boolean;
  error?: string;
}

export async function updateSimilarityThresholds(
  thresholds: SimilarityThresholds
): Promise<UpdateSimilarityThresholdsResult> {
  if (!isValidSimilarityThresholds(thresholds)) {
    return {
      success: false,
      error: "기준값은 0보다 크고 1 이하이며, 경고 기준이 오류 기준보다 작아야 합니다.",
    };
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("auto_publish_settings")
      .update({
        similarity_warning_threshold: thresholds.warning,
        similarity_error_threshold: thresholds.error,
      })
      .eq("id", SETTINGS_ID)
      .select("id");

    if (error) {
      console.error("[bulk-publish-settings] update error:", error.message);
      return { success: false, error: "유사도 기준값을 저장하지 못했습니다." };
    }
    if (!data || data.length === 0) {
      return { success: false, error: "설정 행이 없어 저장하지 못했습니다. migration 013/014 적용 여부를 확인해주세요." };
    }
    return { success: true };
  } catch (err) {
    console.error("[bulk-publish-settings] client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "유사도 기준값을 저장하지 못했습니다." };
  }
}
