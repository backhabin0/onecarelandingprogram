import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/** 관리자 화면에서 고를 수 있는 하루 공개 개수(015 migration의 DB 제약과 같음) */
export const DAILY_LIMIT_MIN = 1;
export const DAILY_LIMIT_MAX = 100;
export const DAILY_LIMIT_DEFAULT = 50;

export interface AutoPublishSettings {
  enabled: boolean;
  dailyLimit: number;
  /** 7단계(016): 얇은 페이지를 noindex로 공개할지(기본 꺼짐) */
  noindexThinPages: boolean;
}

export interface PublishRunRow {
  id: string;
  run_date: string;
  requested_limit: number;
  published_count: number;
  failed_count: number;
  started_at: string;
  finished_at: string | null;
  trigger: "cron" | "manual" | null;
}

export function isValidDailyLimit(value: number): boolean {
  return Number.isInteger(value) && value >= DAILY_LIMIT_MIN && value <= DAILY_LIMIT_MAX;
}

export async function getAutoPublishSettings(): Promise<{
  data: AutoPublishSettings;
  error: string | null;
}> {
  const fallback = { enabled: false, dailyLimit: DAILY_LIMIT_DEFAULT, noindexThinPages: false };
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("auto_publish_settings")
      .select("enabled, daily_limit, noindex_thin_pages")
      .eq("id", "default")
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("[auto-publish] settings select error:", error.message);
      return { data: fallback, error: "자동 공개 설정을 불러오지 못했습니다." };
    }
    return {
      data: {
        enabled: data.enabled,
        dailyLimit: data.daily_limit,
        noindexThinPages: data.noindex_thin_pages === true,
      },
      error: null,
    };
  } catch (err) {
    console.error("[auto-publish] client error:", err instanceof Error ? err.message : err);
    return { data: fallback, error: "자동 공개 설정을 불러오지 못했습니다." };
  }
}

export async function updateAutoPublishSettings(
  settings: AutoPublishSettings
): Promise<{ success: boolean; error?: string }> {
  if (!isValidDailyLimit(settings.dailyLimit)) {
    return { success: false, error: `하루 개수는 ${DAILY_LIMIT_MIN}~${DAILY_LIMIT_MAX} 사이의 정수여야 합니다.` };
  }
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("auto_publish_settings")
      .update({
        enabled: settings.enabled,
        daily_limit: settings.dailyLimit,
        noindex_thin_pages: settings.noindexThinPages,
      })
      .eq("id", "default")
      .select("id");
    if (error) {
      console.error("[auto-publish] settings update error:", error.message);
      return { success: false, error: "자동 공개 설정을 저장하지 못했습니다." };
    }
    if (!data || data.length === 0) {
      return { success: false, error: "설정 행이 없어 저장하지 못했습니다. migration 013~015 적용 여부를 확인해주세요." };
    }
    return { success: true };
  } catch (err) {
    console.error("[auto-publish] client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "자동 공개 설정을 저장하지 못했습니다." };
  }
}

/** 최근 실행 기록(최신 날짜 순) */
export async function getRecentPublishRuns(
  limit = 10
): Promise<{ data: PublishRunRow[]; error: string | null }> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("publish_runs")
      .select("id, run_date, requested_limit, published_count, failed_count, started_at, finished_at, trigger")
      .order("run_date", { ascending: false })
      .range(0, limit - 1);
    if (error) {
      console.error("[auto-publish] runs select error:", error.message);
      return { data: [], error: "실행 기록을 불러오지 못했습니다." };
    }
    return { data: (data as PublishRunRow[]) ?? [], error: null };
  } catch (err) {
    console.error("[auto-publish] client error:", err instanceof Error ? err.message : err);
    return { data: [], error: "실행 기록을 불러오지 못했습니다." };
  }
}

export interface RunAutoPublishResult {
  success: boolean;
  /** ok: 실행함, already_ran: 오늘 이미 실행됨 */
  status?: "ok" | "already_ran" | "disabled" | "no_settings";
  published?: number;
  failed?: number;
  error?: string;
}

/**
 * 관리자 '지금 1회 실행'. 켜짐/꺼짐과 관계없이 하루 개수(daily_limit)만큼 공개하며,
 * 같은 한국 날짜에 이미 실행됐으면(매일 자동 실행 포함) 아무것도 하지 않는다.
 */
export async function runAutoPublishNow(): Promise<RunAutoPublishResult> {
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.rpc("run_auto_publish", { p_manual: true });
    if (error) {
      console.error("[auto-publish] run error:", error.message);
      return { success: false, error: "공개를 실행하지 못했습니다." };
    }
    const result = data as { status?: RunAutoPublishResult["status"]; published?: number; failed?: number };
    return {
      success: result.status === "ok" || result.status === "already_ran",
      status: result.status,
      published: result.published ?? 0,
      failed: result.failed ?? 0,
      error: result.status === "no_settings" ? "자동 공개 설정 행이 없습니다." : undefined,
    };
  } catch (err) {
    console.error("[auto-publish] client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "공개를 실행하지 못했습니다." };
  }
}
