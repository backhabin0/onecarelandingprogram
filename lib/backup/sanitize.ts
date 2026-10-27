import "server-only";

import type { LandingPageStatus } from "@/types/landing-page";
import type { LandingPageFaq, LandingPageSeoSettings } from "@/types/seo";
import type {
  ConsultationRequest,
  ConsultationRequestStatus,
} from "@/types/consultation-request";
import type { LandingPageEventType } from "@/types/analytics";
import {
  LANDING_PAGE_QUEUE_SOURCES,
  LANDING_PAGE_QUEUE_STATES,
  type LandingPageQueueFaq,
  type LandingPageQueueSource,
  type LandingPageQueueState,
} from "@/types/publish-queue";
import {
  BACKUP_FORMAT,
  SUPPORTED_BACKUP_VERSIONS,
  type BackupData,
  type BackupEventRow,
  type BackupFile,
  type BackupLandingPage,
  type BackupQueueRow,
  LANDING_PAGE_LOCAL_SEO_KEYS,
  PHOTO_KEYS,
  QUEUE_PHOTO_KEYS,
  QUEUE_LOCAL_SEO_KEYS,
  type BackupMediaAsset,
  type BackupSiteProfile,
  type BackupSiteVerificationSettings,
  type BackupStorageManifestEntry,
} from "@/types/backup";
import { isMediaKind, isMediaMime, isSha256Hex } from "@/lib/media/library";

/**
 * 업로드된 백업 JSON을 안전하게 해석한다.
 *
 * 절대 `Object.assign`/spread로 통째 병합하지 않는다 — 모든 필드를 이 파일의
 * 함수들이 알려진 키 이름으로 하나씩 명시적으로 읽고, 새 plain object에
 * 하나씩 옮겨 담는다. `__proto__`/`constructor`/`prototype` 같은 키가
 * 포함돼 있어도 우리가 그 이름으로 읽지 않으므로 자연스럽게 무시된다.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * version 2부터는 published_at이 반드시 있어야 한다(null 또는 날짜).
 * version 1 파일에는 이 키가 없으므로 결과에도 넣지 않는다 — 복구할 때
 * published_at을 쓰지 않아 현재 DB 값이 유지된다.
 */
function sanitizeLandingPage(item: unknown, version: number): BackupLandingPage | null {
  if (!isPlainRecord(item)) return null;
  const r = item;

  if (!isUuid(r.id)) return null;
  if (!isString(r.business_name) || !isString(r.title) || !isString(r.slug)) {
    return null;
  }
  if (
    !isNullableString(r.hero_text) ||
    !isNullableString(r.description) ||
    !isNullableString(r.phone) ||
    !isNullableString(r.kakao_url) ||
    !isNullableString(r.address) ||
    !isNullableString(r.logo_url) ||
    !isNullableString(r.main_image_url)
  ) {
    return null;
  }
  if (!isString(r.template)) return null;
  if (r.status !== "public" && r.status !== "private") return null;
  if (!isIsoDateString(r.created_at) || !isIsoDateString(r.updated_at)) {
    return null;
  }

  if (version >= 2 && r.published_at !== null && !isIsoDateString(r.published_at)) {
    return null;
  }
  const localSeo = pickNullableStrings(r, LANDING_PAGE_LOCAL_SEO_KEYS, version >= 3);
  if (!localSeo) return null;
  const photos = pickNullableStrings(r, PHOTO_KEYS, version >= 4);
  if (!photos) return null;

  const status: LandingPageStatus = r.status;

  const page: BackupLandingPage = {
    id: r.id,
    business_name: r.business_name,
    title: r.title,
    slug: r.slug,
    hero_text: r.hero_text,
    description: r.description,
    phone: r.phone,
    kakao_url: r.kakao_url,
    address: r.address,
    logo_url: r.logo_url,
    main_image_url: r.main_image_url,
    template: r.template,
    status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  if (version >= 2) {
    page.published_at = r.published_at as string | null;
  }
  return { ...page, ...localSeo, ...photos };
}

function sanitizeSeoSettings(item: unknown): LandingPageSeoSettings | null {
  if (!isPlainRecord(item)) return null;
  const r = item;

  if (!isUuid(r.landing_page_id)) return null;
  if (
    !isNullableString(r.seo_title) ||
    !isNullableString(r.seo_description) ||
    !isNullableString(r.og_title) ||
    !isNullableString(r.og_description) ||
    !isNullableString(r.og_image_url) ||
    !isNullableString(r.business_category) ||
    !isNullableString(r.service_area)
  ) {
    return null;
  }
  if (!isBoolean(r.seo_noindex) || !isBoolean(r.disable_auto_faq)) return null;
  if (!isIsoDateString(r.created_at) || !isIsoDateString(r.updated_at)) {
    return null;
  }

  return {
    landing_page_id: r.landing_page_id,
    seo_title: r.seo_title,
    seo_description: r.seo_description,
    og_title: r.og_title,
    og_description: r.og_description,
    og_image_url: r.og_image_url,
    seo_noindex: r.seo_noindex,
    business_category: r.business_category,
    service_area: r.service_area,
    disable_auto_faq: r.disable_auto_faq,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function sanitizeFaq(item: unknown): LandingPageFaq | null {
  if (!isPlainRecord(item)) return null;
  const r = item;

  if (!isUuid(r.id) || !isUuid(r.landing_page_id)) return null;
  if (!isString(r.question) || !isString(r.answer)) return null;
  if (!isFiniteNumber(r.sort_order) || !isBoolean(r.is_active)) return null;
  if (!isIsoDateString(r.created_at) || !isIsoDateString(r.updated_at)) {
    return null;
  }

  return {
    id: r.id,
    landing_page_id: r.landing_page_id,
    question: r.question,
    answer: r.answer,
    sort_order: r.sort_order,
    is_active: r.is_active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const CONSULTATION_STATUSES: readonly ConsultationRequestStatus[] = [
  "new",
  "contacted",
  "completed",
  "cancelled",
];

function sanitizeConsultation(item: unknown): ConsultationRequest | null {
  if (!isPlainRecord(item)) return null;
  const r = item;

  if (!isUuid(r.id)) return null;
  if (r.landing_page_id !== null && !isUuid(r.landing_page_id)) return null;
  if (!isString(r.name) || !isString(r.phone)) return null;
  if (!isNullableString(r.message)) return null;
  if (!isBoolean(r.privacy_consent)) return null;
  if (
    typeof r.status !== "string" ||
    !CONSULTATION_STATUSES.includes(r.status as ConsultationRequestStatus)
  ) {
    return null;
  }
  if (r.submission_id !== null && !isString(r.submission_id)) return null;
  if (!isIsoDateString(r.created_at)) return null;

  return {
    id: r.id,
    landing_page_id: r.landing_page_id,
    name: r.name,
    phone: r.phone,
    message: r.message,
    privacy_consent: r.privacy_consent,
    status: r.status as ConsultationRequestStatus,
    submission_id: r.submission_id,
    created_at: r.created_at,
  };
}

const EVENT_TYPES: readonly LandingPageEventType[] = [
  "page_view",
  "phone_click",
  "kakao_click",
];

function sanitizeEvent(item: unknown): BackupEventRow | null {
  if (!isPlainRecord(item)) return null;
  const r = item;

  if (!isUuid(r.id)) return null;
  if (r.landing_page_id !== null && !isUuid(r.landing_page_id)) return null;
  if (
    typeof r.event_type !== "string" ||
    !EVENT_TYPES.includes(r.event_type as LandingPageEventType)
  ) {
    return null;
  }
  if (!isIsoDateString(r.created_at)) return null;

  return {
    id: r.id,
    landing_page_id: r.landing_page_id,
    event_type: r.event_type as LandingPageEventType,
    created_at: r.created_at,
  };
}

/** 대표 업체 정보(version 4부터). 다섯 칸이 모두 문자열 또는 null이어야 한다 */
function sanitizeSiteProfile(value: unknown): BackupSiteProfile | null {
  if (!isPlainRecord(value)) return null;
  const keys = ["business_name", "description", "phone", "kakao_url", "logo_url"] as const;
  const picked = pickNullableStrings(value, keys, true);
  if (!picked) return null;
  return {
    business_name: picked.business_name ?? null,
    description: picked.description ?? null,
    phone: picked.phone ?? null,
    kakao_url: picked.kakao_url ?? null,
    logo_url: picked.logo_url ?? null,
  };
}

const isPositiveInt = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;

/** 사진 보관함 목록 한 행(version 4부터). DB 제약과 같은 범위만 받는다 */
function sanitizeMediaAsset(item: unknown): BackupMediaAsset | null {
  if (!isPlainRecord(item)) return null;
  const r = item;
  if (!isUuid(r.id) || !isSha256Hex(r.sha256) || !isMediaKind(r.kind) || !isMediaMime(r.mime)) return null;
  if (!isString(r.name) || r.name.length < 1 || r.name.length > 200) return null;
  // 설명은 없으면 빈 값(설명 칸이 생기기 전 개발 중 파일)
  const description = r.description === undefined ? "" : r.description;
  if (!isString(description) || description.length > 200) return null;
  if (!isString(r.storage_path) || !isString(r.og_storage_path) || !isString(r.url) || !isString(r.og_url)) return null;
  if (!r.storage_path.startsWith(`library/${r.sha256}.`) || r.og_storage_path !== `library/${r.sha256}-og.jpg`) return null;
  if (!isPositiveInt(r.width, 4096) || !isPositiveInt(r.height, 4096)) return null;
  if (!isPositiveInt(r.bytes, 2097152) || !isPositiveInt(r.og_bytes, 2097152)) return null;
  if (!isIsoDateString(r.created_at)) return null;
  return {
    id: r.id,
    sha256: r.sha256,
    kind: r.kind,
    name: r.name,
    description,
    storage_path: r.storage_path,
    url: r.url,
    og_storage_path: r.og_storage_path,
    og_url: r.og_url,
    mime: r.mime,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    og_bytes: r.og_bytes,
    created_at: r.created_at,
  };
}

function sanitizeSiteVerification(
  value: unknown
): BackupSiteVerificationSettings | null {
  if (!isPlainRecord(value)) return null;
  const google = value.google_site_verification;
  const naver = value.naver_site_verification;
  if (!isNullableString(google) || !isNullableString(naver)) return null;

  return {
    google_site_verification: google,
    naver_site_verification: naver,
  };
}

const MANIFEST_KINDS = ["logo", "main", "og", "image2", "image3"] as const;

function sanitizeStorageManifestEntry(
  item: unknown
): BackupStorageManifestEntry | null {
  if (!isPlainRecord(item)) return null;
  const r = item;

  if (!isUuid(r.landingPageId)) return null;
  if (
    typeof r.kind !== "string" ||
    !(MANIFEST_KINDS as readonly string[]).includes(r.kind)
  ) {
    return null;
  }
  if (!isString(r.url)) return null;
  if (!isNullableString(r.path)) return null;

  return {
    landingPageId: r.landingPageId,
    kind: r.kind as BackupStorageManifestEntry["kind"],
    url: r.url,
    path: r.path,
  };
}

function sanitizeQueueFaqs(value: unknown): LandingPageQueueFaq[] | null {
  if (!Array.isArray(value)) return null;
  const faqs: LandingPageQueueFaq[] = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !isString(item.question) || !isString(item.answer)) {
      return null;
    }
    faqs.push({ question: item.question, answer: item.answer });
  }
  return faqs;
}

/**
 * version 3 이상이면 keys가 모두 문자열 또는 null이어야 하고(아니면 null 반환), 그 값만
 * 새 객체에 담는다. 그보다 예전 형식이면 빈 객체 — 복구 때 그 칸을 쓰지 않게 한다.
 */
function pickNullableStrings<K extends string>(
  r: Record<string, unknown>,
  keys: readonly K[],
  required: boolean
): Partial<Record<K, string | null>> | null {
  const picked: Partial<Record<K, string | null>> = {};
  if (!required) return picked;
  for (const key of keys) {
    const value = r[key];
    if (!isNullableString(value)) return null;
    picked[key] = value;
  }
  return picked;
}

function sanitizeQueueRow(item: unknown, version: number): BackupQueueRow | null {
  if (!isPlainRecord(item)) return null;
  const r = item;
  const localSeo = pickNullableStrings(r, QUEUE_LOCAL_SEO_KEYS, version >= 3);
  if (!localSeo) return null;
  const photos = pickNullableStrings(r, QUEUE_PHOTO_KEYS, version >= 4);
  if (!photos) return null;

  if (!isUuid(r.id)) return null;
  if (
    !isString(r.region) ||
    !isString(r.keyword) ||
    !isString(r.region_slug) ||
    !isString(r.keyword_slug) ||
    !isString(r.business_name) ||
    !isString(r.title) ||
    !isString(r.slug) ||
    !isString(r.template)
  ) {
    return null;
  }
  if (
    !isNullableString(r.hero_text) ||
    !isNullableString(r.description) ||
    !isNullableString(r.phone) ||
    !isNullableString(r.kakao_url) ||
    !isNullableString(r.address) ||
    !isNullableString(r.seo_title) ||
    !isNullableString(r.seo_description) ||
    !isNullableString(r.service_area) ||
    !isNullableString(r.business_category)
  ) {
    return null;
  }
  const faqs = sanitizeQueueFaqs(r.faqs);
  if (!faqs) return null;
  if (
    typeof r.source !== "string" ||
    !(LANDING_PAGE_QUEUE_SOURCES as readonly string[]).includes(r.source)
  ) {
    return null;
  }
  if (
    typeof r.state !== "string" ||
    !(LANDING_PAGE_QUEUE_STATES as readonly string[]).includes(r.state)
  ) {
    return null;
  }
  if (!Array.isArray(r.validation_errors)) return null;

  // numeric 컬럼은 문자열로 올 수도 있어 숫자로 바꿔 받는다.
  const maxSimilarity =
    r.max_similarity === null
      ? null
      : typeof r.max_similarity === "string"
        ? Number(r.max_similarity)
        : r.max_similarity;
  if (
    maxSimilarity !== null &&
    (!isFiniteNumber(maxSimilarity) || maxSimilarity < 0 || maxSimilarity > 1)
  ) {
    return null;
  }
  if (!isFiniteNumber(r.priority) || !Number.isInteger(r.priority)) return null;
  if (r.published_at !== null && !isIsoDateString(r.published_at)) return null;
  if (r.landing_page_id !== null && !isUuid(r.landing_page_id)) return null;
  if (r.batch_id !== null && !isUuid(r.batch_id)) return null;
  if (!isIsoDateString(r.created_at)) return null;

  return {
    id: r.id,
    region: r.region,
    keyword: r.keyword,
    region_slug: r.region_slug,
    keyword_slug: r.keyword_slug,
    business_name: r.business_name,
    title: r.title,
    slug: r.slug,
    hero_text: r.hero_text,
    description: r.description,
    phone: r.phone,
    kakao_url: r.kakao_url,
    address: r.address,
    template: r.template,
    seo_title: r.seo_title,
    seo_description: r.seo_description,
    service_area: r.service_area,
    business_category: r.business_category,
    faqs,
    source: r.source as LandingPageQueueSource,
    state: r.state as LandingPageQueueState,
    // jsonb에 그대로 저장되는 값이라 구조를 바꾸지 않고, JSON으로 다시 만들어 복사한다.
    validation_errors: JSON.parse(JSON.stringify(r.validation_errors)) as unknown[],
    max_similarity: maxSimilarity,
    priority: r.priority,
    published_at: r.published_at,
    landing_page_id: r.landing_page_id,
    batch_id: r.batch_id,
    created_at: r.created_at,
    ...localSeo,
    ...photos,
  };
}

function sanitizeArray<T>(
  value: unknown,
  sanitizer: (item: unknown) => T | null
): { rows: T[]; invalid: number } {
  if (!Array.isArray(value)) return { rows: [], invalid: 0 };

  const rows: T[] = [];
  let invalid = 0;
  for (const item of value) {
    const sanitized = sanitizer(item);
    if (sanitized === null) {
      invalid += 1;
      continue;
    }
    rows.push(sanitized);
  }
  return { rows, invalid };
}

export interface ParseBackupResult {
  success: boolean;
  error?: string;
  backup?: BackupFile;
  invalidCounts?: Partial<Record<keyof BackupData, number>>;
}

/**
 * 백업 파일 원문(JSON 텍스트)을 파싱하고 검증한다.
 * format/version이 다르면 즉시 거부한다. 배열 항목 중 형식이 맞지 않는
 * row는 전체를 거부하는 대신 개별적으로 걸러내고 개수를 invalidCounts에
 * 기록한다 — 호출부(dry-run/restore)가 이 개수를 "성공"으로 표시하지 않는다.
 */
export function parseAndValidateBackupFile(rawText: string): ParseBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { success: false, error: "올바른 JSON 파일이 아닙니다." };
  }

  if (!isPlainRecord(parsed)) {
    return { success: false, error: "지원하지 않는 백업 파일입니다." };
  }

  if (parsed.format !== BACKUP_FORMAT) {
    return { success: false, error: "지원하지 않는 백업 파일입니다." };
  }

  const version = parsed.version;
  if (typeof version !== "number" || !SUPPORTED_BACKUP_VERSIONS.includes(version)) {
    return {
      success: false,
      error: `지원하지 않는 백업 버전입니다. (version: ${String(parsed.version)})`,
    };
  }

  if (!isPlainRecord(parsed.data)) {
    return { success: false, error: "백업 파일에 data가 없습니다." };
  }

  const data = parsed.data;
  const invalidCounts: Partial<Record<keyof BackupData, number>> = {};

  const landingPages = sanitizeArray(data.landingPages, (item) =>
    sanitizeLandingPage(item, version)
  );
  const seoSettings = sanitizeArray(data.seoSettings, sanitizeSeoSettings);
  const faqs = sanitizeArray(data.faqs, sanitizeFaq);
  const consultations = sanitizeArray(data.consultations, sanitizeConsultation);
  const events = sanitizeArray(data.events, sanitizeEvent);
  const storageManifest = sanitizeArray(
    data.storageManifest,
    sanitizeStorageManifestEntry
  );
  // 대기열은 version 2부터 들어 있다.
  const publishQueue =
    version >= 2
      ? sanitizeArray(data.publishQueue, (item) => sanitizeQueueRow(item, version))
      : { rows: [], invalid: 0 };

  if (landingPages.invalid > 0) invalidCounts.landingPages = landingPages.invalid;
  if (seoSettings.invalid > 0) invalidCounts.seoSettings = seoSettings.invalid;
  if (faqs.invalid > 0) invalidCounts.faqs = faqs.invalid;
  if (consultations.invalid > 0) invalidCounts.consultations = consultations.invalid;
  if (events.invalid > 0) invalidCounts.events = events.invalid;
  if (publishQueue.invalid > 0) invalidCounts.publishQueue = publishQueue.invalid;
  // 대표 업체 정보·사진 보관함 목록은 version 4부터 들어 있다.
  const mediaAssets =
    version >= 4 ? sanitizeArray(data.mediaAssets, sanitizeMediaAsset) : { rows: [], invalid: 0 };
  if (mediaAssets.invalid > 0) invalidCounts.mediaAssets = mediaAssets.invalid;

  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version,
    exportedAt: isString(parsed.exportedAt) ? parsed.exportedAt : "",
    site: isString(parsed.site) ? parsed.site : "",
    counts: {
      landingPages: landingPages.rows.length,
      seoSettings: seoSettings.rows.length,
      faqs: faqs.rows.length,
      consultations: consultations.rows.length,
      events: events.rows.length,
      publishQueue: publishQueue.rows.length,
    },
    data: {
      landingPages: landingPages.rows,
      seoSettings: seoSettings.rows,
      faqs: faqs.rows,
      consultations: consultations.rows,
      events: events.rows,
      siteVerificationSettings: sanitizeSiteVerification(
        data.siteVerificationSettings
      ),
      storageManifest: storageManifest.rows,
      publishQueue: publishQueue.rows,
      siteProfile: version >= 4 ? sanitizeSiteProfile(data.siteProfile) : null,
      mediaAssets: mediaAssets.rows,
    },
  };

  return { success: true, backup, invalidCounts };
}
