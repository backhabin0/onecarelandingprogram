"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isUuid, sanitizeUploadValues } from "@/lib/bulk-upload/payload";
import {
  EDITABLE_QUEUE_STATES,
  deleteQueueItems,
  releaseHeldItems,
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
