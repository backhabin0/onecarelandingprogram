import type { MediaKind } from "@/lib/media/library";
import type { BulkUploadField } from "./columns";
import type { UploadRow } from "./parse";

/**
 * 대량 등록 "공통 사진 설정": 로고·대표 사진(사진1)·현장 사진(사진2·3)을 보관함에서 골라 두면
 * 그 칸이 빈 행에만 넣는다(행에 값이 있으면 행이 우선). 값은 보관함 이름으로 넣으므로
 * 이후 검사가 엑셀에 이름을 쓴 것과 똑같이 주소로 바꾸고, 설명 칸이 비면 보관함 설명을 쓴다.
 */

export type CommonPhotoField = Extract<BulkUploadField, "logoUrl" | "mainImageUrl" | "image2Url" | "image3Url">;

export const COMMON_PHOTO_SLOTS: readonly { field: CommonPhotoField; label: string; kind: MediaKind }[] = [
  { field: "logoUrl", label: "로고", kind: "logo" },
  { field: "mainImageUrl", label: "대표 사진(사진1)", kind: "photo" },
  { field: "image2Url", label: "현장 사진(사진2)", kind: "photo" },
  { field: "image3Url", label: "현장 사진(사진3)", kind: "photo" },
];

/** 고른 보관함 사진(이름은 검사·저장용, 주소는 미리보기용) */
export interface CommonPhotoChoice {
  name: string;
  url: string;
}

export type CommonPhotoSettings = Partial<Record<CommonPhotoField, CommonPhotoChoice>>;

/** 한 행 안에서 같은 사진이 두 번 들어가지 않게 비교하는 사진 칸(로고는 따로) */
const PHOTO_FIELDS: readonly CommonPhotoField[] = ["mainImageUrl", "image2Url", "image3Url"];

const sameName = (a: string, b: string) => a.normalize("NFKC").trim().toLowerCase() === b.normalize("NFKC").trim().toLowerCase();

/**
 * 빈 칸에만 공통 사진을 넣는다. 그 행의 다른 사진 칸에 이미 같은 사진(이름 또는 주소)이 있으면 넣지 않는다.
 * 원래 행은 바꾸지 않고 새 행을 돌려준다. filledRows = 하나라도 채운 행 수.
 */
export function applyCommonPhotos(
  rows: readonly UploadRow[],
  settings: CommonPhotoSettings
): { rows: UploadRow[]; filledRows: number } {
  let filledRows = 0;
  const next = rows.map((row) => {
    const values = { ...row.values };
    let filled = false;
    for (const { field } of COMMON_PHOTO_SLOTS) {
      const choice = settings[field];
      if (!choice || (values[field] ?? "").trim()) continue;
      if (field !== "logoUrl") {
        const used = PHOTO_FIELDS.map((f) => (values[f] ?? "").trim()).filter(Boolean);
        if (used.some((value) => sameName(value, choice.name) || value === choice.url)) continue;
      }
      values[field] = choice.name;
      filled = true;
    }
    if (filled) filledRows += 1;
    return filled ? { ...row, values } : row;
  });
  return { rows: next, filledRows };
}

/** 이 브라우저에 마지막 선택을 기억하는 키 */
export const COMMON_PHOTOS_STORAGE_KEY = "onecare.bulk.commonPhotos.v1";

const isChoice = (value: unknown): value is CommonPhotoChoice =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommonPhotoChoice).name === "string" &&
  typeof (value as CommonPhotoChoice).url === "string" &&
  (value as CommonPhotoChoice).name.length > 0 &&
  (value as CommonPhotoChoice).name.length <= 200 &&
  (value as CommonPhotoChoice).url.length <= 500;

/** 저장해 둔 값 읽기: 형식이 틀리거나 모르는 칸은 버린다 */
export function parseCommonPhotoSettings(raw: string | null): CommonPhotoSettings {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const settings: CommonPhotoSettings = {};
    for (const { field } of COMMON_PHOTO_SLOTS) {
      const value = (parsed as Record<string, unknown>)[field];
      if (isChoice(value)) settings[field] = { name: value.name, url: value.url };
    }
    return settings;
  } catch {
    return {};
  }
}

export function loadCommonPhotoSettings(): CommonPhotoSettings {
  try {
    return parseCommonPhotoSettings(window.localStorage.getItem(COMMON_PHOTOS_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function saveCommonPhotoSettings(settings: CommonPhotoSettings): void {
  try {
    window.localStorage.setItem(COMMON_PHOTOS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 개인정보 보호 모드 등 저장할 수 없으면 이번 화면에서만 쓴다.
  }
}
