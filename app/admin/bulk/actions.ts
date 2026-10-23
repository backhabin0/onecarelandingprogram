"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getSimilarityThresholds } from "@/lib/bulk-publish-settings";
import type { CorpusEntry } from "@/lib/bulk-upload/check";
import { loadBulkCheckContext } from "@/lib/bulk-upload/context";
import { enqueueUploadRows, type EnqueueRowResult } from "@/lib/bulk-upload/enqueue";
import { MAX_UPLOAD_ROWS } from "@/lib/bulk-upload/parse";
import { isUuid, sanitizeStringList, sanitizeUploadPayload } from "@/lib/bulk-upload/payload";
import type { SimilarityThresholds } from "@/lib/bulk-upload/similarity";

export interface BulkCheckContextActionResult {
  success: boolean;
  error?: string;
  existingSlugs?: string[];
  existingPairs?: { region: string; keyword: string }[];
  corpus?: CorpusEntry[];
  thresholds?: SimilarityThresholds;
  /** 기준값을 못 불러와 기본값으로 검사하는 경우 안내 문구 */
  thresholdsNotice?: string | null;
}

/**
 * 미리보기 검사용 DB 정보. 파일 전체의 slug·키워드를 받아 이미 쓰는 slug,
 * 대기열의 지역·키워드, 같은 키워드의 기존 문구를 돌려준다.
 */
export async function getBulkCheckContextAction(input: {
  slugs: unknown;
  keywords: unknown;
}): Promise<BulkCheckContextActionResult> {
  await requireUser();

  const slugs = sanitizeStringList(input.slugs, MAX_UPLOAD_ROWS);
  const keywords = sanitizeStringList(input.keywords, MAX_UPLOAD_ROWS);
  if (!slugs || !keywords) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const [{ thresholds, error: thresholdsNotice }, { context, error }] = await Promise.all([
    getSimilarityThresholds(),
    loadBulkCheckContext({ slugs, keywords }),
  ]);
  if (error) return { success: false, error };

  return { success: true, ...context, thresholds, thresholdsNotice };
}

export interface EnqueueBulkRowsActionResult {
  success: boolean;
  error?: string;
  results?: EnqueueRowResult[];
}

/** 나눠 보낸 행 묶음 하나를 서버에서 다시 검사한 뒤 대기열에 저장한다. */
export async function enqueueBulkRowsAction(input: {
  rows: unknown;
  holdSimilar: unknown;
  batchId: unknown;
}): Promise<EnqueueBulkRowsActionResult> {
  await requireUser();

  const rows = sanitizeUploadPayload(input.rows);
  if (!rows || typeof input.holdSimilar !== "boolean" || !isUuid(input.batchId)) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const { results, error } = await enqueueUploadRows({
    rows,
    holdSimilar: input.holdSimilar,
    batchId: input.batchId,
  });

  if (results.some((r) => r.outcome !== "skipped")) {
    revalidatePath("/admin/queue");
  }

  return error ? { success: false, error, results } : { success: true, results };
}
