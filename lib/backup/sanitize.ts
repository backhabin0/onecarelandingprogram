import "server-only";

import type { LandingPage, LandingPageStatus } from "@/types/landing-page";
import type { LandingPageFaq, LandingPageSeoSettings } from "@/types/seo";
import type {
  ConsultationRequest,
  ConsultationRequestStatus,
} from "@/types/consultation-request";
import type { LandingPageEventType } from "@/types/analytics";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupData,
  type BackupEventRow,
  type BackupFile,
  type BackupSiteVerificationSettings,
  type BackupStorageManifestEntry,
} from "@/types/backup";

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

function sanitizeLandingPage(item: unknown): LandingPage | null {
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

  const status: LandingPageStatus = r.status;

  return {
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

const MANIFEST_KINDS = ["logo", "main", "og"] as const;

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

  if (parsed.version !== BACKUP_VERSION) {
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

  const landingPages = sanitizeArray(data.landingPages, sanitizeLandingPage);
  const seoSettings = sanitizeArray(data.seoSettings, sanitizeSeoSettings);
  const faqs = sanitizeArray(data.faqs, sanitizeFaq);
  const consultations = sanitizeArray(data.consultations, sanitizeConsultation);
  const events = sanitizeArray(data.events, sanitizeEvent);
  const storageManifest = sanitizeArray(
    data.storageManifest,
    sanitizeStorageManifestEntry
  );

  if (landingPages.invalid > 0) invalidCounts.landingPages = landingPages.invalid;
  if (seoSettings.invalid > 0) invalidCounts.seoSettings = seoSettings.invalid;
  if (faqs.invalid > 0) invalidCounts.faqs = faqs.invalid;
  if (consultations.invalid > 0) invalidCounts.consultations = consultations.invalid;
  if (events.invalid > 0) invalidCounts.events = events.invalid;

  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: isString(parsed.exportedAt) ? parsed.exportedAt : "",
    site: isString(parsed.site) ? parsed.site : "",
    counts: {
      landingPages: landingPages.rows.length,
      seoSettings: seoSettings.rows.length,
      faqs: faqs.rows.length,
      consultations: consultations.rows.length,
      events: events.rows.length,
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
    },
  };

  return { success: true, backup, invalidCounts };
}
