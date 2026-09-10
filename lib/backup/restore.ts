import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isReservedSlug } from "@/lib/slug";
import type { LandingPage } from "@/types/landing-page";
import type { LandingPageFaq, LandingPageSeoSettings } from "@/types/seo";
import type { ConsultationRequest } from "@/types/consultation-request";
import type { BackupEventRow, BackupFile } from "@/types/backup";

const WRITE_CHUNK_SIZE = 500;
const ID_FETCH_PAGE_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/** id(uuid) 컬럼 하나만 페이지네이션으로 전부 가져온다. 대량 데이터에도 안전하게 Set으로 반환한다. */
async function fetchAllIds(
  supabase: SupabaseClient,
  table: string,
  column: string
): Promise<{ ids: Set<string>; error: string | null }> {
  const ids = new Set<string>();
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, "is", null)
      .range(from, from + ID_FETCH_PAGE_SIZE - 1);

    if (error) {
      console.error(`[backup-restore] ${table}.${column} select error:`, error.message);
      return { ids: new Set(), error: `${table} 현재 상태를 확인하지 못했습니다.` };
    }

    const page = (data ?? []) as unknown as Record<string, string>[];
    for (const row of page) {
      const value = row[column];
      if (value) ids.add(value);
    }

    if (page.length < ID_FETCH_PAGE_SIZE) break;
    from += ID_FETCH_PAGE_SIZE;
  }

  return { ids, error: null };
}

export interface LandingPageConflict {
  id: string;
  slug: string;
  reason: "slug_taken_by_other_id" | "reserved_slug" | "duplicate_slug_in_backup";
}

export interface RestorePlan {
  landingPages: {
    rowsToWrite: LandingPage[];
    toInsertCount: number;
    toUpdateCount: number;
    conflicts: LandingPageConflict[];
    currentOnlyCount: number;
  };
  seoSettings: {
    rowsToWrite: LandingPageSeoSettings[];
    toInsertCount: number;
    toUpdateCount: number;
    orphanCount: number;
  };
  faqs: {
    rowsToWrite: LandingPageFaq[];
    toInsertCount: number;
    toUpdateCount: number;
    orphanCount: number;
  };
  consultations: {
    rowsToInsert: ConsultationRequest[];
    skipExistingCount: number;
    submissionConflictCount: number;
    orphanCount: number;
  };
  events: {
    rowsToInsert: BackupEventRow[];
    skipExistingCount: number;
    orphanCount: number;
  };
  siteVerification: {
    willUpdate: boolean;
  };
  /** landing_pages에 충돌이 하나라도 있으면 false — 이때는 어떤 테이블도 쓰지 않는다. */
  canRestore: boolean;
  blockReason?: string;
}

export interface ComputeRestorePlanResult {
  plan: RestorePlan | null;
  error?: string;
}

/**
 * 현재 DB 상태를 조회해 백업 파일과 비교한 뒤 dry-run 요약(및 실제 실행 시
 * 쓸 행 목록)을 계산한다. DB에 어떤 쓰기도 하지 않는다.
 *
 * landing_pages에 slug 충돌(다른 id가 이미 같은 slug 사용 / reserved slug /
 * 백업 파일 내부 중복)이 하나라도 있으면 canRestore=false가 되고, 호출부는
 * 이 경우 다른 모든 테이블의 복구도 함께 거부해야 한다 — slug는 라우팅에
 * 직접 연결되는 값이라 자동으로 바꾸거나 부분적으로만 복구하지 않는다.
 */
export async function computeRestorePlan(
  backup: BackupFile
): Promise<ComputeRestorePlanResult> {
  try {
    const supabase = await getSupabaseServerClient();

    const { data: currentLandingPages, error: lpError } = await supabase
      .from("landing_pages")
      .select("id, slug");

    if (lpError) {
      console.error("[backup-restore] landing_pages select error:", lpError.message);
      return { plan: null, error: "현재 랜딩페이지 목록을 불러오지 못했습니다." };
    }

    const currentRows = (currentLandingPages ?? []) as { id: string; slug: string }[];
    const currentIdSet = new Set(currentRows.map((r) => r.id));
    const currentSlugOwner = new Map(currentRows.map((r) => [r.slug, r.id] as const));

    // --- landing_pages 충돌/insert-update 판정 ---
    const slugCountInBackup = new Map<string, number>();
    for (const row of backup.data.landingPages) {
      slugCountInBackup.set(row.slug, (slugCountInBackup.get(row.slug) ?? 0) + 1);
    }

    const conflicts: LandingPageConflict[] = [];
    let toInsertCount = 0;
    let toUpdateCount = 0;
    const touchedIds = new Set<string>();

    for (const row of backup.data.landingPages) {
      touchedIds.add(row.id);

      if (isReservedSlug(row.slug)) {
        conflicts.push({ id: row.id, slug: row.slug, reason: "reserved_slug" });
        continue;
      }
      if ((slugCountInBackup.get(row.slug) ?? 0) > 1) {
        conflicts.push({
          id: row.id,
          slug: row.slug,
          reason: "duplicate_slug_in_backup",
        });
        continue;
      }
      const slugOwnerId = currentSlugOwner.get(row.slug);
      if (slugOwnerId && slugOwnerId !== row.id) {
        conflicts.push({
          id: row.id,
          slug: row.slug,
          reason: "slug_taken_by_other_id",
        });
        continue;
      }

      if (currentIdSet.has(row.id)) {
        toUpdateCount += 1;
      } else {
        toInsertCount += 1;
      }
    }

    const currentOnlyCount = currentRows.filter((r) => !touchedIds.has(r.id)).length;
    const canRestore = conflicts.length === 0;

    // 충돌이 있으면 나머지 테이블은 계산할 필요 없이(어차피 실행되지 않는다)
    // 최소한의 plan만 반환해 dry-run 응답을 빠르게 한다.
    if (!canRestore) {
      return {
        plan: {
          landingPages: {
            rowsToWrite: [],
            toInsertCount,
            toUpdateCount,
            conflicts,
            currentOnlyCount,
          },
          seoSettings: { rowsToWrite: [], toInsertCount: 0, toUpdateCount: 0, orphanCount: 0 },
          faqs: { rowsToWrite: [], toInsertCount: 0, toUpdateCount: 0, orphanCount: 0 },
          consultations: {
            rowsToInsert: [],
            skipExistingCount: 0,
            submissionConflictCount: 0,
            orphanCount: 0,
          },
          events: { rowsToInsert: [], skipExistingCount: 0, orphanCount: 0 },
          siteVerification: { willUpdate: false },
          canRestore: false,
          blockReason:
            "URL(slug) 충돌이 있어 복구를 실행할 수 없습니다. 충돌 목록을 확인해주세요.",
        },
      };
    }

    // 복구 실행 시 landing_pages를 먼저 upsert하므로, 이후 단계의 "parent 존재"
    // 판정 기준은 (현재 이미 있는 id) ∪ (이번에 충돌 없이 쓰여질 backup id) 이다.
    const resultingLandingPageIds = new Set(currentIdSet);
    for (const row of backup.data.landingPages) {
      resultingLandingPageIds.add(row.id);
    }

    // --- seo settings ---
    const { ids: currentSeoIds, error: seoIdsError } = await fetchAllIds(
      supabase,
      "landing_page_seo_settings",
      "landing_page_id"
    );
    if (seoIdsError) return { plan: null, error: seoIdsError };

    const seoRowsToWrite: LandingPageSeoSettings[] = [];
    let seoInsert = 0;
    let seoUpdate = 0;
    let seoOrphan = 0;
    for (const row of backup.data.seoSettings) {
      if (!resultingLandingPageIds.has(row.landing_page_id)) {
        seoOrphan += 1;
        continue;
      }
      seoRowsToWrite.push(row);
      if (currentSeoIds.has(row.landing_page_id)) seoUpdate += 1;
      else seoInsert += 1;
    }

    // --- faqs ---
    const { ids: currentFaqIds, error: faqIdsError } = await fetchAllIds(
      supabase,
      "landing_page_faqs",
      "id"
    );
    if (faqIdsError) return { plan: null, error: faqIdsError };

    const faqRowsToWrite: LandingPageFaq[] = [];
    let faqInsert = 0;
    let faqUpdate = 0;
    let faqOrphan = 0;
    for (const row of backup.data.faqs) {
      if (!resultingLandingPageIds.has(row.landing_page_id)) {
        faqOrphan += 1;
        continue;
      }
      faqRowsToWrite.push(row);
      if (currentFaqIds.has(row.id)) faqUpdate += 1;
      else faqInsert += 1;
    }

    // --- consultations: 존재하는 id는 절대 덮어쓰지 않는다(스킵). ---
    const { ids: currentConsultationIds, error: consultIdsError } = await fetchAllIds(
      supabase,
      "consultation_requests",
      "id"
    );
    if (consultIdsError) return { plan: null, error: consultIdsError };

    const { ids: currentSubmissionIds, error: submissionIdsError } = await fetchAllIds(
      supabase,
      "consultation_requests",
      "submission_id"
    );
    if (submissionIdsError) return { plan: null, error: submissionIdsError };

    const consultationsToInsert: ConsultationRequest[] = [];
    let consultSkipExisting = 0;
    let consultSubmissionConflict = 0;
    let consultOrphan = 0;
    for (const row of backup.data.consultations) {
      if (currentConsultationIds.has(row.id)) {
        consultSkipExisting += 1;
        continue;
      }
      if (row.landing_page_id !== null && !resultingLandingPageIds.has(row.landing_page_id)) {
        consultOrphan += 1;
        continue;
      }
      if (row.submission_id !== null && currentSubmissionIds.has(row.submission_id)) {
        consultSubmissionConflict += 1;
        continue;
      }
      consultationsToInsert.push(row);
    }

    // --- events(Analytics): 존재하는 id는 스킵(불변 데이터이므로 update 없음). ---
    const { ids: currentEventIds, error: eventIdsError } = await fetchAllIds(
      supabase,
      "landing_page_events",
      "id"
    );
    if (eventIdsError) return { plan: null, error: eventIdsError };

    const eventsToInsert: BackupEventRow[] = [];
    let eventSkipExisting = 0;
    let eventOrphan = 0;
    for (const row of backup.data.events) {
      if (currentEventIds.has(row.id)) {
        eventSkipExisting += 1;
        continue;
      }
      if (row.landing_page_id !== null && !resultingLandingPageIds.has(row.landing_page_id)) {
        eventOrphan += 1;
        continue;
      }
      eventsToInsert.push(row);
    }

    return {
      plan: {
        landingPages: {
          rowsToWrite: backup.data.landingPages,
          toInsertCount,
          toUpdateCount,
          conflicts: [],
          currentOnlyCount,
        },
        seoSettings: {
          rowsToWrite: seoRowsToWrite,
          toInsertCount: seoInsert,
          toUpdateCount: seoUpdate,
          orphanCount: seoOrphan,
        },
        faqs: {
          rowsToWrite: faqRowsToWrite,
          toInsertCount: faqInsert,
          toUpdateCount: faqUpdate,
          orphanCount: faqOrphan,
        },
        consultations: {
          rowsToInsert: consultationsToInsert,
          skipExistingCount: consultSkipExisting,
          submissionConflictCount: consultSubmissionConflict,
          orphanCount: consultOrphan,
        },
        events: {
          rowsToInsert: eventsToInsert,
          skipExistingCount: eventSkipExisting,
          orphanCount: eventOrphan,
        },
        siteVerification: {
          willUpdate: backup.data.siteVerificationSettings !== null,
        },
        canRestore: true,
      },
    };
  } catch (err) {
    console.error("[backup-restore] plan client error:", err instanceof Error ? err.message : err);
    return { plan: null, error: "복구 계획을 계산하지 못했습니다." };
  }
}

export type RestorePhase =
  | "landing_pages"
  | "seo_settings"
  | "faqs"
  | "consultations"
  | "events"
  | "site_verification";

export interface RestoreExecutionResult {
  /**
   * "success": 모든 단계가 오류 없이 끝남.
   * "blocked": landing_pages 충돌로 아무것도 쓰지 않고 중단됨.
   * "partial_failure": 일부 단계까지는 반영됐지만 중간에 실패해 중단됨.
   */
  status: "success" | "blocked" | "partial_failure";
  error?: string;
  failedPhase?: RestorePhase;
  landingPages: { inserted: number; updated: number; conflicts: number };
  seoSettings: { inserted: number; updated: number; orphan: number };
  faqs: { inserted: number; updated: number; orphan: number };
  consultations: { inserted: number; skipped: number; submissionConflicts: number; orphan: number };
  events: { inserted: number; skipped: number; orphan: number };
  siteVerification: { updated: boolean };
}

/**
 * 병합(merge) 복구를 실제로 실행한다. requireUser()로 인증을 확인한 호출부
 * (Route Handler)에서만 호출해야 한다.
 *
 * 순서: landing_pages → seo_settings → faqs → consultations → events →
 * site_verification_settings. 각 단계는 upsert/insert를 청크 단위로 나눠
 * 호출하고, 어느 단계에서든 예상치 못한 DB 오류가 나면 그 즉시 멈추고
 * "partial_failure"를 반환한다(이미 반영된 이전 단계까지 되돌리는 자동
 * rollback은 없다 — 이 프로젝트에 트랜잭션 인프라가 없으므로, 실패 시
 * 무엇이 어디까지 반영됐는지를 정확히 보고하는 쪽을 택했다).
 */
export async function executeMergeRestore(
  backup: BackupFile
): Promise<RestoreExecutionResult> {
  const emptyResult = (): RestoreExecutionResult => ({
    status: "success",
    landingPages: { inserted: 0, updated: 0, conflicts: 0 },
    seoSettings: { inserted: 0, updated: 0, orphan: 0 },
    faqs: { inserted: 0, updated: 0, orphan: 0 },
    consultations: { inserted: 0, skipped: 0, submissionConflicts: 0, orphan: 0 },
    events: { inserted: 0, skipped: 0, orphan: 0 },
    siteVerification: { updated: false },
  });

  const { plan, error: planError } = await computeRestorePlan(backup);

  if (planError || !plan) {
    const result = emptyResult();
    result.status = "partial_failure";
    result.error = planError ?? "복구 계획을 계산하지 못했습니다.";
    return result;
  }

  if (!plan.canRestore) {
    const result = emptyResult();
    result.status = "blocked";
    result.error = plan.blockReason ?? "URL(slug) 충돌이 있어 복구를 실행할 수 없습니다.";
    result.landingPages.conflicts = plan.landingPages.conflicts.length;
    return result;
  }

  const supabase = await getSupabaseServerClient();
  const result = emptyResult();

  try {
    // 1) landing_pages — 충돌이 전혀 없음이 이미 보장됐으므로 id 기준으로
    // 그대로 upsert한다(있으면 update, 없으면 insert).
    for (const rows of chunk(plan.landingPages.rowsToWrite, WRITE_CHUNK_SIZE)) {
      const { error } = await supabase
        .from("landing_pages")
        .upsert(
          rows.map((r) => ({
            id: r.id,
            business_name: r.business_name,
            title: r.title,
            slug: r.slug,
            hero_text: r.hero_text,
            description: r.description,
            phone: r.phone,
            kakao_url: r.kakao_url,
            address: r.address,
            logo_url: r.logo_url,
            main_image_url: r.main_image_url,
            template: r.template,
            status: r.status,
            created_at: r.created_at,
            updated_at: r.updated_at,
          })),
          { onConflict: "id" }
        );
      if (error) {
        console.error("[backup-restore] landing_pages upsert error:", error.message);
        result.status = "partial_failure";
        result.failedPhase = "landing_pages";
        result.error = "랜딩페이지 복구 중 오류가 발생했습니다.";
        return result;
      }
    }
    result.landingPages.inserted = plan.landingPages.toInsertCount;
    result.landingPages.updated = plan.landingPages.toUpdateCount;

    // 2) seo settings
    for (const rows of chunk(plan.seoSettings.rowsToWrite, WRITE_CHUNK_SIZE)) {
      const { error } = await supabase
        .from("landing_page_seo_settings")
        .upsert(
          rows.map((r) => ({
            landing_page_id: r.landing_page_id,
            seo_title: r.seo_title,
            seo_description: r.seo_description,
            og_title: r.og_title,
            og_description: r.og_description,
            og_image_url: r.og_image_url,
            seo_noindex: r.seo_noindex,
            business_category: r.business_category,
            service_area: r.service_area,
            disable_auto_faq: r.disable_auto_faq,
          })),
          { onConflict: "landing_page_id" }
        );
      if (error) {
        console.error("[backup-restore] seo_settings upsert error:", error.message);
        result.status = "partial_failure";
        result.failedPhase = "seo_settings";
        result.error = "SEO 설정 복구 중 오류가 발생했습니다.";
        return result;
      }
    }
    result.seoSettings.inserted = plan.seoSettings.toInsertCount;
    result.seoSettings.updated = plan.seoSettings.toUpdateCount;
    result.seoSettings.orphan = plan.seoSettings.orphanCount;

    // 3) faqs
    for (const rows of chunk(plan.faqs.rowsToWrite, WRITE_CHUNK_SIZE)) {
      const { error } = await supabase.from("landing_page_faqs").upsert(
        rows.map((r) => ({
          id: r.id,
          landing_page_id: r.landing_page_id,
          question: r.question,
          answer: r.answer,
          sort_order: r.sort_order,
          is_active: r.is_active,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
        { onConflict: "id" }
      );
      if (error) {
        console.error("[backup-restore] faqs upsert error:", error.message);
        result.status = "partial_failure";
        result.failedPhase = "faqs";
        result.error = "FAQ 복구 중 오류가 발생했습니다.";
        return result;
      }
    }
    result.faqs.inserted = plan.faqs.toInsertCount;
    result.faqs.updated = plan.faqs.toUpdateCount;
    result.faqs.orphan = plan.faqs.orphanCount;

    // 4) consultations — 항상 insert만 한다(존재하는 id는 plan 단계에서 이미 제외됨).
    for (const rows of chunk(plan.consultations.rowsToInsert, WRITE_CHUNK_SIZE)) {
      const { error } = await supabase.from("consultation_requests").insert(
        rows.map((r) => ({
          id: r.id,
          landing_page_id: r.landing_page_id,
          name: r.name,
          phone: r.phone,
          message: r.message,
          privacy_consent: r.privacy_consent,
          status: r.status,
          submission_id: r.submission_id,
          created_at: r.created_at,
        }))
      );
      if (error) {
        console.error("[backup-restore] consultations insert error:", error.message);
        result.status = "partial_failure";
        result.failedPhase = "consultations";
        result.error = "상담 데이터 복구 중 오류가 발생했습니다.";
        return result;
      }
    }
    result.consultations.inserted = plan.consultations.rowsToInsert.length;
    result.consultations.skipped = plan.consultations.skipExistingCount;
    result.consultations.submissionConflicts = plan.consultations.submissionConflictCount;
    result.consultations.orphan = plan.consultations.orphanCount;

    // 5) events(Analytics) — consultations와 동일하게 insert만 한다.
    for (const rows of chunk(plan.events.rowsToInsert, WRITE_CHUNK_SIZE)) {
      const { error } = await supabase.from("landing_page_events").insert(
        rows.map((r) => ({
          id: r.id,
          landing_page_id: r.landing_page_id,
          event_type: r.event_type,
          created_at: r.created_at,
        }))
      );
      if (error) {
        console.error("[backup-restore] events insert error:", error.message);
        result.status = "partial_failure";
        result.failedPhase = "events";
        result.error = "통계 데이터 복구 중 오류가 발생했습니다.";
        return result;
      }
    }
    result.events.inserted = plan.events.rowsToInsert.length;
    result.events.skipped = plan.events.skipExistingCount;
    result.events.orphan = plan.events.orphanCount;

    // 6) site_verification_settings — singleton row 갱신.
    if (backup.data.siteVerificationSettings) {
      const { error } = await supabase
        .from("site_verification_settings")
        .update({
          google_site_verification: backup.data.siteVerificationSettings.google_site_verification,
          naver_site_verification: backup.data.siteVerificationSettings.naver_site_verification,
          updated_at: new Date().toISOString(),
        })
        .eq("id", "default");
      if (error) {
        console.error("[backup-restore] site_verification_settings update error:", error.message);
        result.status = "partial_failure";
        result.failedPhase = "site_verification";
        result.error = "검색엔진 인증 설정 복구 중 오류가 발생했습니다.";
        return result;
      }
      result.siteVerification.updated = true;
    }

    return result;
  } catch (err) {
    console.error("[backup-restore] execute client error:", err instanceof Error ? err.message : err);
    result.status = "partial_failure";
    result.error = "복구 실행 중 오류가 발생했습니다.";
    return result;
  }
}
