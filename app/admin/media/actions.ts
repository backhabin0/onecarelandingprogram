"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/bulk-upload/payload";
import {
  deleteMediaAsset,
  getMediaAssetBySha,
  listMediaAssets,
  registerMediaAsset,
  updateMediaAssetDescription,
  type RegisterMediaAssetResult,
} from "@/lib/media-assets";
import { isMediaKind, isMediaMime, isSha256Hex, type MediaAsset, type MediaKind } from "@/lib/media/library";

/** 같은 사진이 이미 보관함에 있는지(업로드 전에 확인해 다시 올리지 않는다) */
export async function findMediaAssetByShaAction(
  sha256: unknown
): Promise<{ asset: MediaAsset | null; error: string | null }> {
  await requireUser();
  if (!isSha256Hex(sha256)) return { asset: null, error: "잘못된 요청입니다." };
  const { data, error } = await getMediaAssetBySha(sha256);
  return { asset: data, error };
}

const isDimension = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4096;

/** 브라우저가 올린 파일을 보관함 목록에 등록한다(서버가 파일이 있는지·크기를 다시 확인). */
export async function registerMediaAssetAction(input: {
  sha256: unknown;
  kind: unknown;
  fileName: unknown;
  description?: unknown;
  mime: unknown;
  width: unknown;
  height: unknown;
}): Promise<RegisterMediaAssetResult> {
  await requireUser();
  if (
    !isSha256Hex(input.sha256) ||
    !isMediaKind(input.kind) ||
    typeof input.fileName !== "string" ||
    input.fileName.length > 1000 ||
    (input.description !== undefined && (typeof input.description !== "string" || input.description.length > 1000)) ||
    !isMediaMime(input.mime) ||
    !isDimension(input.width) ||
    !isDimension(input.height)
  ) {
    return { success: false, error: "잘못된 요청입니다." };
  }
  const result = await registerMediaAsset({
    sha256: input.sha256,
    kind: input.kind,
    fileName: input.fileName,
    description: typeof input.description === "string" ? input.description : "",
    mime: input.mime,
    width: input.width,
    height: input.height,
  });
  if (result.success) revalidatePath("/admin/media");
  return result;
}

/** 보관함에서 고르기 창의 목록 */
export async function listMediaAssetsAction(input: {
  search: unknown;
  kind: unknown;
  page: unknown;
}): Promise<{ data: MediaAsset[]; count: number; error: string | null }> {
  await requireUser();
  const kind: MediaKind | "all" = isMediaKind(input.kind) ? input.kind : "all";
  const search = typeof input.search === "string" ? input.search.slice(0, 200) : "";
  const page = typeof input.page === "number" && Number.isInteger(input.page) && input.page > 0 ? input.page : 1;
  return listMediaAssets({ search, kind, page, pageSize: 24 });
}

/** 보관함 사진 설명 바꾸기(200자까지, 제어 문자·줄바꿈은 정리) */
export async function updateMediaAssetDescriptionAction(
  id: unknown,
  description: unknown
): Promise<{ success: boolean; asset?: MediaAsset; error?: string }> {
  await requireUser();
  if (!isUuid(id) || typeof description !== "string" || description.length > 1000) {
    return { success: false, error: "잘못된 요청입니다." };
  }
  const result = await updateMediaAssetDescription(id, description);
  if (result.success) revalidatePath("/admin/media");
  return result;
}

/** 보관함 사진 삭제(쓰는 곳이 있으면 거절) */
export async function deleteMediaAssetAction(id: unknown): Promise<{ success: boolean; error?: string }> {
  await requireUser();
  if (!isUuid(id)) return { success: false, error: "잘못된 요청입니다." };
  const result = await deleteMediaAsset(id);
  if (result.success) revalidatePath("/admin/media");
  return result;
}
