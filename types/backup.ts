import type { LandingPage } from "@/types/landing-page";
import type { LandingPageFaq, LandingPageSeoSettings } from "@/types/seo";
import type { ConsultationRequest } from "@/types/consultation-request";
import type { LandingPageEventType } from "@/types/analytics";
import type { LandingPageQueueRow } from "@/types/publish-queue";

export const BACKUP_FORMAT = "onecare-backup" as const;
/**
 * 2: landing_pages.published_at과 publishQueue(landing_page_queue)를 추가했다.
 * 1: 그 이전 형식. 계속 읽을 수 있다(published_at 없음 → 복구 시 현재 값 유지, 대기열 없음).
 */
export const BACKUP_VERSION = 2 as const;
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2];

/**
 * 백업 안의 랜딩페이지. version 1 파일에는 published_at 키가 없다 — 이 경우
 * 복구할 때 published_at을 쓰지 않아 현재 DB 값이 그대로 남는다.
 */
export type BackupLandingPage = Omit<LandingPage, "published_at"> & {
  published_at?: string | null;
};

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
  landingPages: BackupLandingPage[];
  seoSettings: LandingPageSeoSettings[];
  faqs: LandingPageFaq[];
  consultations: ConsultationRequest[];
  events: BackupEventRow[];
  siteVerificationSettings: BackupSiteVerificationSettings | null;
  storageManifest: BackupStorageManifestEntry[];
  /** landing_page_queue 전체(version 2부터). version 1 파일이면 빈 배열 */
  publishQueue: LandingPageQueueRow[];
}

export interface BackupCounts {
  landingPages: number;
  seoSettings: number;
  faqs: number;
  consultations: number;
  events: number;
  publishQueue: number;
}

/** 이 앱이 만들고 읽을 수 있는 백업 파일의 최상위 구조. */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  /** 읽을 때는 SUPPORTED_BACKUP_VERSIONS 중 하나, 만들 때는 항상 BACKUP_VERSION */
  version: number;
  /** UTC ISO 8601 */
  exportedAt: string;
  site: string;
  counts: BackupCounts;
  data: BackupData;
}
