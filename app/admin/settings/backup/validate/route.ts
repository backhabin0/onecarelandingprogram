import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseAndValidateBackupFile } from "@/lib/backup/sanitize";
import { computeRestorePlan } from "@/lib/backup/restore";

export const dynamic = "force-dynamic";

// 문자열 길이 기준 대략적인 상한(대부분 ASCII/JSON이라 바이트 수와 크게
// 다르지 않다). 정확한 바이트 측정이 아니라 "너무 큰 파일을 실수로 올리는"
// 상황을 막기 위한 안전장치다.
const MAX_BACKUP_TEXT_LENGTH = 50 * 1024 * 1024;

/**
 * 복구 1단계: 업로드된 백업 파일을 검증하고, 실제 DB를 바꾸지 않는
 * dry-run 결과(추가/수정/건너뜀/충돌 요약)를 반환한다.
 *
 * 클라이언트에서 JSON.parse해 바로 신뢰하지 않는다 — 원문 텍스트만 받아
 * 이 서버에서 다시 파싱/검증한다(클라이언트 검증은 보조 수단일 뿐이다).
 */
export async function POST(request: NextRequest) {
  await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "요청 본문을 읽지 못했습니다." },
      { status: 400 }
    );
  }

  const backupText =
    typeof body === "object" && body !== null && "backupText" in body
      ? (body as { backupText: unknown }).backupText
      : undefined;

  if (typeof backupText !== "string" || backupText.length === 0) {
    return NextResponse.json(
      { success: false, error: "백업 파일 내용이 없습니다." },
      { status: 400 }
    );
  }

  if (backupText.length > MAX_BACKUP_TEXT_LENGTH) {
    return NextResponse.json(
      { success: false, error: "파일 크기가 50MB를 초과합니다." },
      { status: 400 }
    );
  }

  const parsed = parseAndValidateBackupFile(backupText);
  if (!parsed.success || !parsed.backup) {
    return NextResponse.json(
      { success: false, error: parsed.error ?? "지원하지 않는 백업 파일입니다." },
      { status: 400 }
    );
  }

  const { plan, error: planError } = await computeRestorePlan(parsed.backup);
  if (planError || !plan) {
    return NextResponse.json(
      { success: false, error: planError ?? "복구 계획을 계산하지 못했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    backupMeta: {
      exportedAt: parsed.backup.exportedAt,
      site: parsed.backup.site,
      counts: parsed.backup.counts,
    },
    invalidCounts: parsed.invalidCounts ?? {},
    plan: {
      canRestore: plan.canRestore,
      blockReason: plan.blockReason,
      landingPages: {
        toInsertCount: plan.landingPages.toInsertCount,
        toUpdateCount: plan.landingPages.toUpdateCount,
        currentOnlyCount: plan.landingPages.currentOnlyCount,
        conflicts: plan.landingPages.conflicts,
      },
      seoSettings: {
        toInsertCount: plan.seoSettings.toInsertCount,
        toUpdateCount: plan.seoSettings.toUpdateCount,
        orphanCount: plan.seoSettings.orphanCount,
      },
      faqs: {
        toInsertCount: plan.faqs.toInsertCount,
        toUpdateCount: plan.faqs.toUpdateCount,
        orphanCount: plan.faqs.orphanCount,
      },
      consultations: {
        toInsertCount: plan.consultations.rowsToInsert.length,
        skipExistingCount: plan.consultations.skipExistingCount,
        submissionConflictCount: plan.consultations.submissionConflictCount,
        orphanCount: plan.consultations.orphanCount,
      },
      events: {
        toInsertCount: plan.events.rowsToInsert.length,
        skipExistingCount: plan.events.skipExistingCount,
        orphanCount: plan.events.orphanCount,
      },
      siteVerification: plan.siteVerification,
    },
  });
}
