import { LANDING_PAGE_ASSETS_BUCKET } from "@/lib/storage/landing-page-assets";

/**
 * 사진 보관함(019 media_assets) 공용 규칙. 브라우저(업로드·고르기)와 서버(등록·엑셀 검사)가 함께 쓴다.
 *
 * - 파일은 library/{sha256}.webp 한 곳에만 둔다. sha256은 원본 파일 내용의 해시라 같은 사진을
 *   다시 올려도 새로 저장하지 않는다. 브라우저가 WebP를 못 만들면 .jpg(사진)·.png(로고)로 둔다.
 * - og:image용 1200×630 JPEG는 library/{sha256}-og.jpg. 보관함 사진 주소만 보면 OG 주소를
 *   알 수 있어(libraryOgUrlOf) 페이지·대기열에 칸을 따로 두지 않는다.
 */

export const MEDIA_LIBRARY_PREFIX = "library/";
/** 버킷 상한(019)과 같은 2MB. 압축한 뒤 기준 */
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024;
export const MEDIA_NAME_MAX_LENGTH = 200;
/** 사진 설명 — 페이지 사진 설명(alt) 칸과 같은 200자 */
export const MEDIA_DESCRIPTION_MAX_LENGTH = 200;

export type MediaKind = "photo" | "logo";
export const MEDIA_KINDS: readonly MediaKind[] = ["photo", "logo"];

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = { photo: "사진", logo: "로고" };

export type MediaMime = "image/webp" | "image/jpeg" | "image/png";

const MIME_EXTENSION: Record<MediaMime, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** media_assets 행(화면·Server Action 결과용) */
export interface MediaAsset {
  id: string;
  sha256: string;
  kind: MediaKind;
  name: string;
  /** 짧은 설명. 페이지 사진 설명(alt)이 비면 이 값을 쓴다 */
  description: string;
  storage_path: string;
  url: string;
  og_storage_path: string;
  og_url: string;
  mime: MediaMime;
  width: number;
  height: number;
  bytes: number;
  og_bytes: number;
  created_at: string;
}

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === "string" && (MEDIA_KINDS as readonly string[]).includes(value);
}

export function isMediaMime(value: unknown): value is MediaMime {
  return typeof value === "string" && value in MIME_EXTENSION;
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** 보관함 파일 경로: 본 파일과 OG 파일 */
export function buildLibraryPaths(sha256: string, mime: MediaMime): { path: string; ogPath: string } {
  return {
    path: `${MEDIA_LIBRARY_PREFIX}${sha256}.${MIME_EXTENSION[mime]}`,
    ogPath: `${MEDIA_LIBRARY_PREFIX}${sha256}-og.jpg`,
  };
}

/** Supabase Storage 공개 주소(…/storage/v1/object/public/{bucket}/{path}) */
export function buildPublicStorageUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${LANDING_PAGE_ASSETS_BUCKET}/${path}`;
}

const LIBRARY_FILE_PATTERN = new RegExp(
  `/storage/v1/object/public/${LANDING_PAGE_ASSETS_BUCKET}/library/([0-9a-f]{64})\\.(?:webp|jpg|png)$`
);

/**
 * 보관함 사진 주소면 같은 사진의 og:image(1200×630 JPEG) 주소, 아니면 null.
 * 보관함에 올릴 때 항상 두 파일을 함께 올리므로(등록 전에 둘 다 있는지 확인) 주소만으로 정한다.
 */
export function libraryOgUrlOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const [base] = url.split("?");
  const match = LIBRARY_FILE_PATTERN.exec(base);
  if (!match) return null;
  return `${base.slice(0, match.index)}/storage/v1/object/public/${LANDING_PAGE_ASSETS_BUCKET}/library/${match[1]}-og.jpg`;
}

/** 이름 비교용: 앞뒤 공백·대소문자·전각/반각 차이를 무시한다 */
export function normalizeMediaName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

/** 확장자를 뺀 이름("현장1.jpg" → "현장1"). 확장자가 없으면 그대로 */
export function mediaBaseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 올린 파일 이름을 보관함 이름으로: 경로·제어 문자를 빼고 200자까지. 비면 "사진" */
export function sanitizeMediaName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = last.normalize("NFKC").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "사진").slice(0, MEDIA_NAME_MAX_LENGTH);
}

/** 사진 설명 정리: 제어 문자·줄바꿈을 빼고 공백을 하나로, 200자까지 */
export function sanitizeMediaDescription(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEDIA_DESCRIPTION_MAX_LENGTH);
}

/** 이름이 겹칠 때 쓰는 이름: "현장1.jpg" → "현장1 (2).jpg" */
export function numberedMediaName(name: string, n: number): string {
  if (n <= 1) return name;
  const base = mediaBaseName(name);
  const extension = name.slice(base.length);
  const suffix = ` (${n})`;
  return `${base.slice(0, MEDIA_NAME_MAX_LENGTH - suffix.length - extension.length)}${suffix}${extension}`;
}

/** 보관함 이름 → 주소 찾기용 목록(엑셀 사진 칸 검사) */
export interface MediaLibraryEntry {
  name: string;
  url: string;
  /** 보관함 설명(행의 사진 설명이 비면 alt로 쓴다) */
  description: string;
}

export type PhotoReference =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | { kind: "library"; url: string; name: string; description: string }
  | { kind: "not_found"; value: string }
  | { kind: "ambiguous"; value: string; names: string[] }
  | { kind: "invalid_url"; value: string };

/** 주소로 쓰려던 값인지: "https:…", "//…", 또는 "/"가 든 값(보관함 이름에는 "/"가 들어갈 수 없음) */
const looksLikeUrl = (value: string) => /^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes("/");

/**
 * 엑셀·대기열 사진 칸 값 해석: http(s) 주소는 그대로, 그 밖에는 보관함 이름으로 찾는다.
 * 이름은 대소문자·앞뒤 공백을 무시하고 정확히 같은 것을 먼저 찾고, 확장자 없이 쓴 이름이면
 * 확장자를 뺀 이름이 하나만 맞을 때 그 사진을 쓴다(둘 이상이면 어느 것인지 알 수 없어 오류).
 */
export function resolvePhotoReference(raw: string, library: readonly MediaLibraryEntry[]): PhotoReference {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  if (looksLikeUrl(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return { kind: "url", url: value };
    } catch {
      // 아래에서 형식 오류로 돌려준다.
    }
    return { kind: "invalid_url", value };
  }

  const wanted = normalizeMediaName(value);
  const exact = library.find((entry) => normalizeMediaName(entry.name) === wanted);
  if (exact) return { kind: "library", url: exact.url, name: exact.name, description: exact.description };

  if (mediaBaseName(value) === value) {
    const byBase = library.filter((entry) => normalizeMediaName(mediaBaseName(entry.name)) === wanted);
    if (byBase.length === 1) {
      const [entry] = byBase;
      return { kind: "library", url: entry.url, name: entry.name, description: entry.description };
    }
    if (byBase.length > 1) return { kind: "ambiguous", value, names: byBase.map((entry) => entry.name) };
  }
  return { kind: "not_found", value };
}

/** 보관함 이름 후보(엑셀 검사 때 DB에서 찾을 이름): 주소가 아닌 값만, 비교용으로 정규화 */
export function photoNameCandidates(values: readonly string[]): string[] {
  const names = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (value && !looksLikeUrl(value)) names.add(normalizeMediaName(value));
  }
  return Array.from(names);
}

/** 화면 표시용 크기: 1234567 → "1.2MB", 45678 → "45KB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * 보관함에서 사진을 고른 뒤의 사진 설명(alt): 지금 설명이 비어 있으면 보관함 설명을 쓰고,
 * 이미 적어 둔 설명은 그대로 둔다.
 */
export function altAfterPick(currentAlt: string | null | undefined, asset: { description?: string | null }): string {
  const current = (currentAlt ?? "").trim();
  return current ? (currentAlt ?? "") : (asset.description ?? "").trim();
}
