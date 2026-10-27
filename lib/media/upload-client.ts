import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { LANDING_PAGE_ASSETS_BUCKET } from "@/lib/storage/landing-page-assets";
import { compressForLibrary } from "@/lib/media/compress";
import { buildLibraryPaths, type MediaAsset, type MediaKind } from "@/lib/media/library";
import { findMediaAssetByShaAction, registerMediaAssetAction } from "@/app/admin/media/actions";

/**
 * 브라우저에서 사진 1장을 보관함에 올린다: 압축 → 같은 사진이 있으면 그대로 사용 →
 * Storage에 본 파일·OG 파일 업로드 → 서버에 등록. 실패하면 안내 문구를 돌려준다.
 */
export async function uploadToLibrary(
  file: File,
  kind: MediaKind,
  description = ""
): Promise<{ asset: MediaAsset; reused: boolean } | { error: string }> {
  let compressed;
  try {
    compressed = await compressForLibrary(file, kind);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "사진을 줄이지 못했습니다." };
  }

  const found = await findMediaAssetByShaAction(compressed.sha256);
  if (found.error) return { error: found.error };
  if (found.asset) return { asset: found.asset, reused: true };

  const supabase = getSupabaseBrowserClient();
  const { path, ogPath } = buildLibraryPaths(compressed.sha256, compressed.mime);
  const uploads: [string, Blob, string][] = [
    [path, compressed.file, compressed.mime],
    [ogPath, compressed.og, "image/jpeg"],
  ];
  for (const [objectPath, blob, contentType] of uploads) {
    const { error } = await supabase.storage
      .from(LANDING_PAGE_ASSETS_BUCKET)
      .upload(objectPath, blob, { contentType, upsert: false, cacheControl: "31536000" });
    // 파일 이름이 내용의 해시라, 이미 있는 파일(전에 올리다 멈춘 경우)은 같은 내용으로 보고 넘어간다.
    if (error && !/exist|duplicate/i.test(error.message)) {
      console.error("[media] upload error:", error.message);
      return { error: "사진을 올리지 못했습니다. 잠시 후 다시 시도해주세요." };
    }
  }

  const registered = await registerMediaAssetAction({
    sha256: compressed.sha256,
    kind,
    fileName: file.name,
    description,
    mime: compressed.mime,
    width: compressed.width,
    height: compressed.height,
  });
  if (!registered.success || !registered.asset) return { error: registered.error ?? "사진 보관함에 등록하지 못했습니다." };
  return { asset: registered.asset, reused: registered.reused === true };
}
