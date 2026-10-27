import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSimilarityThresholds } from "@/lib/bulk-publish-settings";
import {
  buildUploadSlug,
  checkBulkUploadRows,
  collectPhotoValues,
  decideQueueState,
  issuesForStorage,
  type CheckedUploadRow,
} from "./check";
import { loadBulkCheckContext } from "./context";
import type { UploadRow } from "./parse";

export type EnqueueOutcome = "ready" | "hold" | "skipped";

export interface EnqueueRowResult {
  rowNumber: number;
  outcome: EnqueueOutcome;
  /** skipped일 때 이유 */
  reason?: string;
}

export interface EnqueueUploadRowsResult {
  results: EnqueueRowResult[];
  /** 이 묶음 전체를 처리하지 못한 경우(이후 묶음도 멈춰야 함) */
  error: string | null;
}

const CONFLICT_REASON = "이미 사용 중인 URL이거나 같은 지역·키워드가 대기열에 있습니다.";

function toInsertRow(row: CheckedUploadRow, state: "ready" | "hold", batchId: string) {
  return {
    ...row.queueRow,
    source: "excel",
    state,
    batch_id: batchId,
    validation_errors: issuesForStorage(row),
  };
}

/**
 * 브라우저가 나눠 보낸 행 묶음을 서버에서 다시 검사한 뒤 대기열에 저장한다.
 * 브라우저 미리보기 결과는 믿지 않는다 — 같은 규칙(checkBulkUploadRows)을
 * 서버가 DB의 최신 상태로 다시 돌린다. 앞 묶음은 이미 저장됐으므로 유사도와
 * 중복 검사에 자연스럽게 포함된다.
 *
 * - 오류 없는 행 → ready, 유사도 오류만 있는 행 → holdSimilar일 때 hold, 나머지 → 건너뜀
 * - 묶음 insert가 unique 충돌(23505)로 실패하면(검사와 저장 사이에 다른 곳에서
 *   같은 slug/지역·키워드가 생긴 경우) 한 행씩 다시 넣어 충돌한 행만 건너뛴다.
 */
export async function enqueueUploadRows(input: {
  rows: UploadRow[];
  holdSimilar: boolean;
  batchId: string;
}): Promise<EnqueueUploadRowsResult> {
  const { rows, holdSimilar, batchId } = input;

  const { thresholds } = await getSimilarityThresholds();
  const { context, error: contextError } = await loadBulkCheckContext({
    slugs: rows.map((row) => buildUploadSlug(row.values)),
    keywords: rows.map((row) => row.values.keyword ?? ""),
    photoValues: collectPhotoValues(rows),
  });
  if (contextError) return { results: [], error: contextError };

  const checked = checkBulkUploadRows(rows, { ...context, thresholds });

  const results = new Map<number, EnqueueRowResult>();
  const toInsert: { row: CheckedUploadRow; state: "ready" | "hold" }[] = [];
  for (const row of checked.rows) {
    const state = decideQueueState(row, holdSimilar);
    if (state) {
      toInsert.push({ row, state });
    } else {
      results.set(row.rowNumber, {
        rowNumber: row.rowNumber,
        outcome: "skipped",
        reason: row.errors[0]?.message ?? "저장할 수 없는 행입니다.",
      });
    }
  }

  if (toInsert.length > 0) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase
      .from("landing_page_queue")
      .insert(toInsert.map(({ row, state }) => toInsertRow(row, state, batchId)));

    if (!error) {
      for (const { row, state } of toInsert) {
        results.set(row.rowNumber, { rowNumber: row.rowNumber, outcome: state });
      }
    } else if (error.code === "23505") {
      for (const { row, state } of toInsert) {
        const single = await supabase
          .from("landing_page_queue")
          .insert(toInsertRow(row, state, batchId));
        if (!single.error) {
          results.set(row.rowNumber, { rowNumber: row.rowNumber, outcome: state });
        } else if (single.error.code === "23505") {
          results.set(row.rowNumber, { rowNumber: row.rowNumber, outcome: "skipped", reason: CONFLICT_REASON });
        } else {
          console.error("[bulk-upload] queue insert error:", single.error.message);
          // 여기까지 한 행씩 저장된 결과는 그대로 알려준다.
          return {
            results: Array.from(results.values()).sort((a, b) => a.rowNumber - b.rowNumber),
            error: "대기열에 저장하는 중 오류가 발생했습니다.",
          };
        }
      }
    } else {
      console.error("[bulk-upload] queue insert error:", error.message);
      return { results: [], error: "대기열에 저장하는 중 오류가 발생했습니다." };
    }
  }

  return {
    results: rows.map(
      (row) => results.get(row.rowNumber) ?? { rowNumber: row.rowNumber, outcome: "skipped" }
    ),
    error: null,
  };
}
