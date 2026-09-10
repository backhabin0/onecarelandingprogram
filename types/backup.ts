import type { LandingPage } from "@/types/landing-page";
import type { LandingPageFaq, LandingPageSeoSettings } from "@/types/seo";
import type { ConsultationRequest } from "@/types/consultation-request";
import type { LandingPageEventType } from "@/types/analytics";

export const BACKUP_FORMAT = "onecare-backup" as const;
export const BACKUP_VERSION = 1 as const;

/** landing_page_events 테이블 row 1건. 이 백업 기능 전용으로 raw row 그대로 다룬다. */
export interface BackupEventRow {
  id: string;
  landing_page_id: string | null;
  event_type: LandingPageEventType;
  created_at: string;
}

/** site_verification_settings의 'default' row 중 백업에 포함하는 필드만. */
export interface BackupSiteVerificationSettings {
  google_site_verification: string | null;
  naver_site_verification: string | null;
}

export interface BackupStorageManifestEntry {
  landingPageId: string;
  kind: "logo" | "main" | "og";
  url: string;
  /** landing-page-assets 버킷 내부 object path. 우리가 업로드한 형태가 아니면 null. */
  path: string | null;
}

export interface BackupData {
  landingPages: LandingPage[];
  seoSettings: LandingPageSeoSettings[];
  faqs: LandingPageFaq[];
  consultations: ConsultationRequest[];
  events: BackupEventRow[];
  siteVerificationSettings: BackupSiteVerificationSettings | null;
  storageManifest: BackupStorageManifestEntry[];
}

export interface BackupCounts {
  landingPages: number;
  seoSettings: number;
  faqs: number;
  consultations: number;
  events: number;
}

/** 이 앱이 만들고 읽을 수 있는 백업 파일의 최상위 구조. */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** UTC ISO 8601 */
  exportedAt: string;
  site: string;
  counts: BackupCounts;
  data: BackupData;
}
