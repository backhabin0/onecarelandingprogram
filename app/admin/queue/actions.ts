"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isUuid, sanitizeUploadValues } from "@/lib/bulk-upload/payload";
import type { RenameTarget } from "@/lib/business-name-rename";
import { BUSINESS_NAME_RENAME_CHUNK_SIZE, validateBusinessNameInput } from "@/lib/landing-page-validation";
import { setSearchSubmissionCheck } from "@/lib/search-submission-checks";
import {
  EDITABLE_QUEUE_STATES,
  deleteQueueItems,
  getQueueRenameTargets,
  isQueueStateFilter,
  releaseHeldItems,
  renameQueueItems,
  updateQueueItem,
  type BulkChangeResult,
  type EditableQueueState,
  type UpdateQueueItemResult,
} from "@/lib/publish-queue";

/** 한 번에 바꿀 수 있는 최대 항목 수(목록 한 페이지 크기와 같음) */
const MAX_IDS = 50;

function sanitizeIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
  return ids.every(isUuid) ? (ids as string[]) : null;
}

export async function updateQueueItemAction(
  id: unknown,
  values: unknown,
  state: unknown
): Promise<UpdateQueueItemResult> {
  await requireUser();

  const cleanValues = sanitizeUploadValues(values);
  if (
    !isUuid(id) ||
    !cleanValues ||
    typeof state !== "string" ||
    !(EDITABLE_QUEUE_STATES as readonly string[]).includes(state)
  ) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await updateQueueItem(id, cleanValues, state as EditableQueueState);
  if (result.success) {
    revalidatePath("/admin/queue");
    revalidatePath(`/admin/queue/${id}/edit`);
  }
  return result;
}

/** 보류(hold) → ready */
export async function releaseHeldItemsAction(ids: unknown): Promise<BulkChangeResult> {
  await requireUser();
  const clean = sanitizeIds(ids);
  if (!clean) return { success: false, changed: 0, error: "잘못된 요청입니다." };

  const result = await releaseHeldItems(clean);
  if (result.success) revalidatePath("/admin/queue");
  return result;
}

/** 삭제(공개된 항목은 지우지 않음) */
export async function deleteQueueItemsAction(ids: unknown): Promise<BulkChangeResult> {
  await requireUser();
  const clean = sanitizeIds(ids);
  if (!clean) return { success: false, changed: 0, error: "잘못된 요청입니다." };

  const result = await deleteQueueItems(clean);
  if (result.success) revalidatePath("/admin/queue");
  return result;
}

/**
 * 선택한 대기열 항목 업체명을 한꺼번에 바꾼다(공개된 항목 제외). 화면은 100개씩 나눠 보낸다.
 * 서버에서 랜딩페이지와 같은 규칙(필수, 100자)으로 다시 검사한다.
 */
export async function renameQueueItemsAction(ids: unknown, businessName: unknown): Promise<BulkChangeResult> {
  await requireUser();
  const valid =
    Array.isArray(ids) && ids.length > 0 && ids.length <= BUSINESS_NAME_RENAME_CHUNK_SIZE && ids.every(isUuid);
  if (!valid || typeof businessName !== "string") {
    return { success: false, changed: 0, error: "잘못된 요청입니다." };
  }
  const { value, error } = validateBusinessNameInput(businessName);
  if (error) return { success: false, changed: 0, error };

  const result = await renameQueueItems(Array.from(new Set(ids as string[])), value);
  if (result.success) revalidatePath("/admin/queue");
  return result;
}

/** 지금 상태 탭·검색 조건에 맞는 대기열 항목 전부(업체명 일괄 변경의 "검색 결과 전체 선택") */
export async function getQueueRenameTargetsAction(
  state: unknown,
  search: unknown
): Promise<{ data: RenameTarget[]; error: string | null }> {
  await requireUser();
  if (typeof state !== "string" || !isQueueStateFilter(state) || typeof search !== "string") {
    return { data: [], error: "잘못된 요청입니다." };
  }
  const { data, error } = await getQueueRenameTargets({ state, search });
  return { data: data.map((row) => ({ id: row.id, businessName: row.business_name })), error };
}

/**
 * 수집 요청(URL 복사) 완료 체크/해제(DB 저장 — 다른 PC에서도 보임).
 * 공개 대기열 '공개된 주소' 카드와 랜딩페이지 목록의 복사완료 칸이 같이 쓴다.
 */
export async function setSearchSubmissionCheckAction(
  landingPageId: unknown,
  checked: unknown
): Promise<{ success: boolean; error?: string }> {
  await requireUser();
  if (!isUuid(landingPageId) || typeof checked !== "boolean") {
    return { success: false, error: "잘못된 요청입니다." };
  }
  const result = await setSearchSubmissionCheck(landingPageId, checked);
  if (result.success) {
    revalidatePath("/admin/queue");
    revalidatePath("/admin/pages");
  }
  return result;
}
