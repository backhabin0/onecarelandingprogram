import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * landing_pages 로고/메인 이미지 전용 Storage 헬퍼.
 * browser client와 server client 모두 동일한 SupabaseClient 인터페이스를
 * 구현하므로, 이 파일의 함수들은 두 컨텍스트 어디서든 그대로 사용할 수 있다.
 */

export const LANDING_PAGE_ASSETS_BUCKET = "landing-page-assets";

export type LandingImageKind = "logo" | "main" | "og";

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
  og: 5 * 1024 * 1024,
};

const MAX_SIZE_MESSAGE: Record<LandingImageKind, string> = {
  logo: "로고 이미지는 3MB 이하로 업로드해주세요.",
  main: "메인 이미지는 10MB 이하로 업로드해주세요.",
  og: "OG 이미지는 5MB 이하로 업로드해주세요.",
};

export interface ValidateImageResult {
  valid: boolean;
  error?: string;
}

function isAllowedMimeType(type: string): type is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(type);
}

// JPEG/PNG/WEBP의 파일 시작 바이트("magic bytes"). File.type은 브라우저가
// 보고하는 값이라 확장자만 바꾼 파일이면 쉽게 속일 수 있으므로, 실제 파일
// 내용의 시작 바이트도 확인해 한 번 더 걸러낸다. 이 검사는 브라우저에서
// 업로드 전에 실행되는 클라이언트 레벨 방어이며, 서버가 파일을 직접 받는
// 구조가 아니므로(브라우저 → Supabase Storage 직접 업로드) 악의적인 관리자의
// 우회까지 막는 절대적인 서버 검증은 아니다 — 잘못된/변조된 파일을 실수로
// 올리는 상황에 대한 방어에 가깝다.
const SIGNATURE_HEADER_SIZE = 12;

function matchesSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

async function hasValidImageSignature(
  file: File,
  mimeType: AllowedMimeType
): Promise<boolean> {
  const header = new Uint8Array(
    await file.slice(0, SIGNATURE_HEADER_SIZE).arrayBuffer()
  );

  if (mimeType === "image/jpeg") {
    return matchesSignature(header, [0xff, 0xd8, 0xff]);
  }

  if (mimeType === "image/png") {
    return matchesSignature(
      header,
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    );
  }

  // WebP = RIFF(4 bytes) + 파일 크기(4 bytes) + "WEBP"(4 bytes)
  return (
    matchesSignature(header, [0x52, 0x49, 0x46, 0x46]) &&
    matchesSignature(header.slice(8, 12), [0x57, 0x45, 0x42, 0x50])
  );
}

export async function validateImageFile(
  file: File,
  kind: LandingImageKind
): Promise<ValidateImageResult> {
  if (!isAllowedMimeType(file.type)) {
    return {
      valid: false,
      error: "JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.",
    };
  }

  if (file.size > MAX_SIZE_BYTES[kind]) {
    return { valid: false, error: MAX_SIZE_MESSAGE[kind] };
  }

  const signatureValid = await hasValidImageSignature(file, file.type);
  if (!signatureValid) {
    return {
      valid: false,
      error:
        "파일 내용이 이미지 형식과 일치하지 않습니다. 실제 JPG/PNG/WEBP 파일을 업로드해주세요.",
    };
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
  const prefix = kind === "logo" ? "logo" : kind === "main" ? "main" : "og";
  return `${prefix}-${crypto.randomUUID()}.${extension}`;
}

export function buildObjectPath(
  landingPageId: string,
  filename: string
): string {
  return `landing-pages/${landingPageId}/${filename}`;
}

/** buildObjectPath()가 실제로 만드는 경로 접두사. 이 밖의 경로는 우리가 업로드한 object가 아니다. */
const OBJECT_PATH_PREFIX = "landing-pages/";

/**
 * Storage public URL(.../storage/v1/object/public/{bucket}/{path})에서
 * bucket 내부 object path만 추출한다. 이 bucket의 URL이 아니거나, 우리가
 * 실제로 업로드하는 "landing-pages/" 경로 형태(buildObjectPath 참고)가
 * 아니면 null — 외부에서 받은 임의의 URL을 Storage 삭제 경로로 오인해
 * 변환하지 않기 위한 안전장치다(삭제는 항상 이 함수를 거쳐야 한다).
 */
export function getStoragePathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${LANDING_PAGE_ASSETS_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;

  const pathWithQuery = publicUrl.slice(index + marker.length);
  const rawPath = pathWithQuery.split("?")[0];

  if (!rawPath) return null;

  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = rawPath;
  }

  if (!path.startsWith(OBJECT_PATH_PREFIX) || path.includes("..")) {
    return null;
  }

  return path;
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
  const validation = await validateImageFile(file, kind);
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
 * public URL이 가리키는 Storage object를 다른 landing_pages/SEO row가 더 이상
 * 참조하지 않을 때만 best-effort로 삭제한다(공유 이미지 안전성 — 15단계 복제
 * 기능이 원본 이미지 URL을 그대로 재사용하므로, 복제본/원본 중 한쪽에서
 * 이미지를 교체/삭제해도 다른 쪽이 여전히 쓰는 파일은 지우면 안 된다).
 * 참조 여부 확인 자체가 실패하면 안전하게 삭제를 건너뛴다.
 * 이 함수는 실패해도 예외를 던지지 않는다 — orphan file은 로그로만 남긴다.
 */
export async function removeLandingPageImageByUrl(
  supabase: SupabaseClient,
  url: string | null | undefined
): Promise<void> {
  if (!url) return;

  const path = getStoragePathFromPublicUrl(url);
  if (!path) return;

  const [logoRef, mainRef, ogRef] = await Promise.all([
    supabase
      .from("landing_pages")
      .select("id", { count: "exact", head: true })
      .eq("logo_url", url),
    supabase
      .from("landing_pages")
      .select("id", { count: "exact", head: true })
      .eq("main_image_url", url),
    supabase
      .from("landing_page_seo_settings")
      .select("landing_page_id", { count: "exact", head: true })
      .eq("og_image_url", url),
  ]);

  if (logoRef.error || mainRef.error || ogRef.error) {
    console.error(
      "[storage] reference check failed, skip remove:",
      logoRef.error ?? mainRef.error ?? ogRef.error
    );
    return;
  }

  const stillReferenced =
    (logoRef.count ?? 0) > 0 || (mainRef.count ?? 0) > 0 || (ogRef.count ?? 0) > 0;

  if (stillReferenced) {
    console.log("[storage] skip remove: asset still referenced by another page");
    return;
  }

  const { error } = await supabase.storage
    .from(LANDING_PAGE_ASSETS_BUCKET)
    .remove([path]);

  if (error) {
    console.error("[storage] remove error:", error);
  }
}
