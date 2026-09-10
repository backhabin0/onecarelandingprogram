import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site";
import { getStoragePathFromPublicUrl } from "@/lib/storage/landing-page-assets";
import type { LandingPage } from "@/types/landing-page";
import type { LandingPageFaq, LandingPageSeoSettings } from "@/types/seo";
import type { ConsultationRequest } from "@/types/consultation-request";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupCounts,
  type BackupEventRow,
  type BackupFile,
  type BackupStorageManifestEntry,
} from "@/types/backup";

/**
 * PostgREST/Supabase는 한 번의 요청으로 반환하는 row 수에 상한이 있을 수
 * 있으므로, 이 크기로 잘라 range(from, to)를 반복 호출해 전체 데이터를
 * 빠짐없이 가져온다. 마지막 페이지의 길이가 이 값보다 작으면 종료한다.
 */
const BACKUP_PAGE_SIZE = 1000;

export interface FetchAllRowsResult<T> {
  data: T[];
  error: string | null;
}

/**
 * 정렬 기준(created_at asc, id asc 등 안정적인 순서)을 적용해 테이블 전체를
 * 페이지네이션으로 조회한다. 중간 페이지 조회가 하나라도 실패하면 그때까지
 * 모은 행을 버리고 즉시 실패를 반환한다 — 불완전한 결과를 반환하지 않는다.
 */
async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  orderColumns: string[]
): Promise<FetchAllRowsResult<T>> {
  const rows: T[] = [];
  let from = 0;

  for (;;) {
    let query = supabase.from(table).select(select);
    for (const column of orderColumns) {
      query = query.order(column, { ascending: true });
    }
    query = query.range(from, from + BACKUP_PAGE_SIZE - 1);

    const { data, error } = await query;

    if (error) {
      console.error(`[backup] ${table} select error (from=${from}):`, error.message);
      return { data: [], error: `${table} 데이터를 불러오지 못했습니다.` };
    }

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < BACKUP_PAGE_SIZE) {
      break;
    }
    from += BACKUP_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

function buildStorageManifest(
  landingPages: LandingPage[],
  seoSettings: LandingPageSeoSettings[]
): BackupStorageManifestEntry[] {
  const manifest: BackupStorageManifestEntry[] = [];

  for (const lp of landingPages) {
    if (lp.logo_url) {
      manifest.push({
        landingPageId: lp.id,
        kind: "logo",
        url: lp.logo_url,
        path: getStoragePathFromPublicUrl(lp.logo_url),
      });
    }
    if (lp.main_image_url) {
      manifest.push({
        landingPageId: lp.id,
        kind: "main",
        url: lp.main_image_url,
        path: getStoragePathFromPublicUrl(lp.main_image_url),
      });
    }
  }

  for (const seo of seoSettings) {
    if (seo.og_image_url) {
      manifest.push({
        landingPageId: seo.landing_page_id,
        kind: "og",
        url: seo.og_image_url,
        path: getStoragePathFromPublicUrl(seo.og_image_url),
      });
    }
  }

  return manifest;
}

export interface BuildBackupFileResult {
  success: boolean;
  error?: string;
  backup?: BackupFile;
}

/**
 * 전체 백업 파일을 생성한다. read-only — 이 함수는 어떤 테이블도 수정하지
 * 않는다. 여섯 조회(landing_pages/seo/faqs/consultations/events/
 * site_verification_settings) 중 하나라도 실패하면 불완전한 백업을
 * 반환하지 않고 즉시 실패로 처리한다.
 */
export async function buildBackupFile(): Promise<BuildBackupFileResult> {
  try {
    const supabase = await getSupabaseServerClient();

    const [landingPagesRes, seoRes, faqsRes, consultationsRes, eventsRes, verificationRes] =
      await Promise.all([
        fetchAllRows<LandingPage>(supabase, "landing_pages", "*", [
          "created_at",
          "id",
        ]),
        fetchAllRows<LandingPageSeoSettings>(
          supabase,
          "landing_page_seo_settings",
          "*",
          ["landing_page_id"]
        ),
        fetchAllRows<LandingPageFaq>(supabase, "landing_page_faqs", "*", [
          "created_at",
          "id",
        ]),
        fetchAllRows<ConsultationRequest>(
          supabase,
          "consultation_requests",
          "*",
          ["created_at", "id"]
        ),
        fetchAllRows<BackupEventRow>(supabase, "landing_page_events", "*", [
          "created_at",
          "id",
        ]),
        supabase
          .from("site_verification_settings")
          .select("google_site_verification, naver_site_verification")
          .eq("id", "default")
          .maybeSingle(),
      ]);

    const firstError =
      landingPagesRes.error ??
      seoRes.error ??
      faqsRes.error ??
      consultationsRes.error ??
      eventsRes.error ??
      (verificationRes.error ? "검색엔진 인증 설정을 불러오지 못했습니다." : null);

    if (firstError) {
      if (verificationRes.error) {
        console.error("[backup] site_verification_settings select error:", verificationRes.error.message);
      }
      return { success: false, error: firstError };
    }

    const counts: BackupCounts = {
      landingPages: landingPagesRes.data.length,
      seoSettings: seoRes.data.length,
      faqs: faqsRes.data.length,
      consultations: consultationsRes.data.length,
      events: eventsRes.data.length,
    };

    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      site: getSiteUrl(),
      counts,
      data: {
        landingPages: landingPagesRes.data,
        seoSettings: seoRes.data,
        faqs: faqsRes.data,
        consultations: consultationsRes.data,
        events: eventsRes.data,
        siteVerificationSettings: verificationRes.data ?? null,
        storageManifest: buildStorageManifest(landingPagesRes.data, seoRes.data),
      },
    };

    return { success: true, backup };
  } catch (err) {
    console.error("[backup] export client error:", err instanceof Error ? err.message : err);
    return { success: false, error: "백업 생성 중 오류가 발생했습니다." };
  }
}

export interface GetCurrentDataCountsResult {
  data: BackupCounts;
  error: string | null;
}

const EMPTY_COUNTS: BackupCounts = {
  landingPages: 0,
  seoSettings: 0,
  faqs: 0,
  consultations: 0,
  events: 0,
};

/** /admin/settings/backup 화면에 표시할 "현재 데이터 현황" — head count만 조회한다(행 데이터 없음). */
export async function getCurrentDataCounts(): Promise<GetCurrentDataCountsResult> {
  try {
    const supabase = await getSupabaseServerClient();

    const [lp, seo, faqs, consultations, events] = await Promise.all([
      supabase.from("landing_pages").select("id", { count: "exact", head: true }),
      supabase
        .from("landing_page_seo_settings")
        .select("landing_page_id", { count: "exact", head: true }),
      supabase.from("landing_page_faqs").select("id", { count: "exact", head: true }),
      supabase
        .from("consultation_requests")
        .select("id", { count: "exact", head: true }),
      supabase.from("landing_page_events").select("id", { count: "exact", head: true }),
    ]);

    const firstError =
      lp.error ?? seo.error ?? faqs.error ?? consultations.error ?? events.error;
    if (firstError) {
      console.error("[backup] current counts error:", firstError.message);
      return { data: EMPTY_COUNTS, error: "현재 데이터 현황을 불러오지 못했습니다." };
    }

    return {
      data: {
        landingPages: lp.count ?? 0,
        seoSettings: seo.count ?? 0,
        faqs: faqs.count ?? 0,
        consultations: consultations.count ?? 0,
        events: events.count ?? 0,
      },
      error: null,
    };
  } catch (err) {
    console.error("[backup] client error:", err instanceof Error ? err.message : err);
    return { data: EMPTY_COUNTS, error: "현재 데이터 현황을 불러오지 못했습니다." };
  }
}

/** app/admin/settings/backup/export/route.ts에서 Content-Disposition 파일명에 사용한다. */
export function buildBackupFilename(exportedAtIso: string): string {
  const safe = exportedAtIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `onecare-backup-${safe || "unknown"}.json`;
}
