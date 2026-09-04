import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * landing_pages 로고/메인 이미지 전용 Storage 헬퍼.
 * browser client와 server client 모두 동일한 SupabaseClient 인터페이스를
 * 구현하므로, 이 파일의 함수들은 두 컨텍스트 어디서든 그대로 사용할 수 있다.
 */

export const LANDING_PAGE_ASSETS_BUCKET = "landing-page-assets";

export type LandingImageKind = "logo" | "main";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const MIME_EXTENSIONS: Record<AllowedMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_SIZE_BYTES: Record<LandingImageKind, number> = {
  logo: 3 * 1024 * 1024,
  main: 10 * 1024 * 1024,
};

const MAX_SIZE_MESSAGE: Record<LandingImageKind, string> = {
  logo: "로고 이미지는 3MB 이하로 업로드해주세요.",
  main: "메인 이미지는 10MB 이하로 업로드해주세요.",
};

export interface ValidateImageResult {
  valid: boolean;
  error?: string;
}

function isAllowedMimeType(type: string): type is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(type);
}

export function validateImageFile(
  file: File,
  kind: LandingImageKind
): ValidateImageResult {
  if (!isAllowedMimeType(file.type)) {
    return {
      valid: false,
      error: "JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.",
    };
  }

  if (file.size > MAX_SIZE_BYTES[kind]) {
    return { valid: false, error: MAX_SIZE_MESSAGE[kind] };
  }

  return { valid: true };
}

export function generateSafeFilename(
  file: File,
  kind: LandingImageKind
): string {
  const extension = isAllowedMimeType(file.type)
    ? MIME_EXTENSIONS[file.type]
    : "jpg";
  const prefix = kind === "logo" ? "logo" : "main";
  return `${prefix}-${crypto.randomUUID()}.${extension}`;
}

export function buildObjectPath(
  landingPageId: string,
  filename: string
): string {
  return `landing-pages/${landingPageId}/${filename}`;
}

/**
 * Storage public URL(.../storage/v1/object/public/{bucket}/{path})에서
 * bucket 내부 object path만 추출한다. 이 bucket의 URL이 아니면 null.
 */
export function getStoragePathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${LANDING_PAGE_ASSETS_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;

  const pathWithQuery = publicUrl.slice(index + marker.length);
  const path = pathWithQuery.split("?")[0];

  if (!path) return null;

  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export interface UploadImageResult {
  url?: string;
  error?: string;
}

/**
 * 이미지를 검증 후 landing-page-assets bucket에 업로드하고 public URL을 반환한다.
 * authenticated 세션이 있는 SupabaseClient가 필요하다(Storage RLS).
 */
export async function uploadLandingPageImage(
  supabase: SupabaseClient,
  landingPageId: string,
  kind: LandingImageKind,
  file: File
): Promise<UploadImageResult> {
  const validation = validateImageFile(file, kind);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const filename = generateSafeFilename(file, kind);
  const path = buildObjectPath(landingPageId, filename);

  const { error: uploadError } = await supabase.storage
    .from(LANDING_PAGE_ASSETS_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[storage] upload error:", uploadError);
    return { error: "이미지를 업로드하지 못했습니다." };
  }

  const { data } = supabase.storage
    .from(LANDING_PAGE_ASSETS_BUCKET)
    .getPublicUrl(path);

  return { url: data.publicUrl };
}

/**
 * public URL이 가리키는 Storage object를 best-effort로 삭제한다.
 * 실패해도 예외를 던지지 않는다 — orphan file은 로그로만 남긴다.
 */
export async function removeLandingPageImageByUrl(
  supabase: SupabaseClient,
  url: string | null | undefined
): Promise<void> {
  if (!url) return;

  const path = getStoragePathFromPublicUrl(url);
  if (!path) return;

  const { error } = await supabase.storage
    .from(LANDING_PAGE_ASSETS_BUCKET)
    .remove([path]);

  if (error) {
    console.error("[storage] remove error:", error);
  }
}
