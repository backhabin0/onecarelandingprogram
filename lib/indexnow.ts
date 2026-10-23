import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAbsoluteUrl, getSiteUrl } from "@/lib/site";

/**
 * IndexNow: 새로 공개된 페이지 주소를 검색엔진에 바로 알린다.
 *
 * - 엔드포인트: 네이버 서치어드바이저(https://searchadvisor.naver.com/indexnow).
 *   IndexNow 공식 FAQ(indexnow.org/faq)에 따르면 참여 엔진 한 곳에 보내면 Bing 등
 *   다른 IndexNow 엔진에도 공유되므로 한 곳에만 보낸다.
 * - 형식(indexnow.org/documentation): POST JSON { host, key, keyLocation, urlList },
 *   한 번에 최대 10,000개. 200 = 접수, 202 = 접수(키 확인 대기), 400/403/422/429 = 실패.
 * - 키: 환경변수 INDEXNOW_KEY. 같은 값의 파일 public/{key}.txt 가 사이트 루트에서
 *   열려야 한다(keyLocation으로도 알려 줌).
 * - DB 함수에서 직접 호출하지 않는다. 앱이 공개 후에 "아직 알리지 않은 공개 페이지"를
 *   모아 보내고 결과를 기록한다. 실패해도 공개에는 영향이 없고, 실패한 페이지는
 *   다음 전송 때 다시 대상이 된다.
 */

export const INDEXNOW_ENDPOINT = "https://searchadvisor.naver.com/indexnow";
export const INDEXNOW_MAX_URLS = 10_000;
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const REQUEST_TIMEOUT_MS = 15_000;
/** 자동 전송(관리자 화면 접속 시)은 최근 실패 후 이 시간 동안 다시 시도하지 않는다 */
export const AUTO_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

export type IndexNowTrigger = "admin" | "cron" | "manual";

export type IndexNowConfig =
  | { ok: true; key: string; host: string; keyLocation: string }
  | { ok: false; reason: string };

/** 환경변수·사이트 주소로 전송 설정을 만든다. 로컬 주소나 http면 보내지 않는다. */
export function getIndexNowConfig(): IndexNowConfig {
  const key = process.env.INDEXNOW_KEY?.trim() ?? "";
  if (!key) return { ok: false, reason: "INDEXNOW_KEY 환경변수가 없습니다." };
  if (!KEY_PATTERN.test(key)) {
    return { ok: false, reason: "INDEXNOW_KEY는 영문·숫자·하이픈 8~128자여야 합니다." };
  }
  const site = new URL(getSiteUrl());
  if (site.protocol !== "https:" || site.hostname === "localhost" || site.hostname === "127.0.0.1") {
    return { ok: false, reason: `사이트 주소(${site.origin})가 공개 https 주소가 아니라 보내지 않습니다.` };
  }
  return { ok: true, key, host: site.host, keyLocation: `${site.origin}/${key}.txt` };
}

export interface IndexNowRunResult {
  status: "sent" | "nothing" | "not_configured" | "failed" | "error";
  urlCount: number;
  statusCode?: number | null;
  message?: string;
}

interface PendingPage {
  landing_page_id: string;
  slug: string;
}

type Fetch = typeof fetch;

async function postToIndexNow(
  config: Extract<IndexNowConfig, { ok: true }>,
  urlList: string[],
  fetchImpl: Fetch
): Promise<{ success: boolean; statusCode: number | null; error: string | null }> {
  try {
    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: config.host, key: config.key, keyLocation: config.keyLocation, urlList }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 200 || response.status === 202) {
      return { success: true, statusCode: response.status, error: null };
    }
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    return { success: false, statusCode: response.status, error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    return { success: false, statusCode: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 아직 알리지 않은 공개 페이지를 모아 IndexNow로 보내고 결과를 기록한다.
 * supabase 클라이언트는 호출하는 쪽이 만든다(Server Component의 after() 안에서는
 * cookies()를 쓸 수 없어서 렌더링 중에 만든 클라이언트를 넘겨받는다).
 * secret: 로그인 없이 부를 때(예약 호출) DB에 넘기는 CRON_SECRET. 로그인 세션이면 null.
 */
export async function submitPendingToIndexNow(options: {
  supabase: SupabaseClient;
  trigger: IndexNowTrigger;
  secret?: string | null;
  fetchImpl?: Fetch;
}): Promise<IndexNowRunResult> {
  const { supabase, trigger, secret = null, fetchImpl = fetch } = options;

  const config = getIndexNowConfig();
  if (!config.ok) return { status: "not_configured", urlCount: 0, message: config.reason };

  const { data, error } = await supabase.rpc("indexnow_pending_pages", {
    p_secret: secret,
    p_limit: INDEXNOW_MAX_URLS,
  });
  if (error) {
    console.error("[indexnow] pending select error:", error.message);
    return { status: "error", urlCount: 0, message: "알릴 페이지 목록을 불러오지 못했습니다." };
  }

  const pages = (data as PendingPage[] | null) ?? [];
  if (pages.length === 0) return { status: "nothing", urlCount: 0 };

  const urlList = pages.map((page) => getAbsoluteUrl(`/${page.slug}`));
  const sent = await postToIndexNow(config, urlList, fetchImpl);

  const { error: recordError } = await supabase.rpc("indexnow_record_submission", {
    p_secret: secret,
    p_page_ids: pages.map((page) => page.landing_page_id),
    p_success: sent.success,
    p_status_code: sent.statusCode,
    p_error: sent.error,
    p_trigger: trigger,
  });
  if (recordError) {
    console.error("[indexnow] record error:", recordError.message);
    return {
      status: "error",
      urlCount: pages.length,
      statusCode: sent.statusCode,
      message: sent.success
        ? "전송은 됐지만 결과를 기록하지 못했습니다. 다음에 같은 주소를 다시 보낼 수 있습니다."
        : "전송에 실패했고 결과도 기록하지 못했습니다.",
    };
  }

  if (!sent.success) {
    console.error("[indexnow] submit failed:", sent.error);
    return { status: "failed", urlCount: pages.length, statusCode: sent.statusCode, message: sent.error ?? undefined };
  }
  return { status: "sent", urlCount: pages.length, statusCode: sent.statusCode };
}

/**
 * 관리자 화면 접속 시 자동 전송을 해도 되는지: 마지막 전송이 최근(10분 이내)에
 * 실패했으면 쉬어 간다(실패가 계속될 때 화면을 열 때마다 검색엔진을 두드리지 않도록).
 */
export async function shouldAutoSubmit(supabase: SupabaseClient, now = Date.now()): Promise<boolean> {
  const { data, error } = await supabase
    .from("indexnow_submissions")
    .select("success, created_at")
    .order("created_at", { ascending: false })
    .range(0, 0);
  if (error) return false;
  const last = (data as { success: boolean; created_at: string }[] | null)?.[0];
  if (!last || last.success) return true;
  return now - Date.parse(last.created_at) >= AUTO_RETRY_COOLDOWN_MS;
}

/** 관리자 화면 접속 시: 조건이 맞으면 전송한다. 예외는 삼키고 로그만 남긴다(화면에 영향 없음). */
export async function autoSubmitIndexNow(supabase: SupabaseClient, fetchImpl: Fetch = fetch): Promise<IndexNowRunResult | null> {
  try {
    if (!getIndexNowConfig().ok) return null;
    if (!(await shouldAutoSubmit(supabase))) return null;
    return await submitPendingToIndexNow({ supabase, trigger: "admin", fetchImpl });
  } catch (err) {
    console.error("[indexnow] auto submit error:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface IndexNowStatus {
  config: IndexNowConfig;
  pendingCount: number;
  recent: { created_at: string; trigger: string; url_count: number; success: boolean; status_code: number | null; error: string | null }[];
  error: string | null;
}

/** 설정 화면 표시용: 설정 상태, 아직 알리지 않은 페이지 수, 최근 전송 기록 */
export async function getIndexNowStatus(supabase: SupabaseClient): Promise<IndexNowStatus> {
  const config = getIndexNowConfig();
  const [pending, recent] = await Promise.all([
    supabase.rpc("indexnow_pending_pages", { p_secret: null, p_limit: INDEXNOW_MAX_URLS }),
    supabase
      .from("indexnow_submissions")
      .select("created_at, trigger, url_count, success, status_code, error")
      .order("created_at", { ascending: false })
      .range(0, 9),
  ]);
  const error = pending.error || recent.error ? "IndexNow 상태를 불러오지 못했습니다." : null;
  return {
    config,
    pendingCount: ((pending.data as unknown[] | null) ?? []).length,
    recent: (recent.data as IndexNowStatus["recent"] | null) ?? [],
    error,
  };
}
