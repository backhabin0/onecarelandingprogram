import type { LandingPage } from "@/types/landing-page";
import type { LandingPageFaq, LandingPageSeoSettings } from "@/types/seo";
import type { ConsultationRequest } from "@/types/consultation-request";
import type { LandingPageEventType } from "@/types/analytics";
import type { LandingPageQueueRow } from "@/types/publish-queue";
import type { MediaAsset } from "@/lib/media/library";

export const BACKUP_FORMAT = "onecare-backup" as const;
/**
 * 4: 사진 칸(019 migration — 랜딩페이지·대기열 image_2_url·image_2_alt·image_3_url·image_3_alt),
 *    대표 업체 정보(site_profile, 로고 포함)와 사진 보관함 목록(media_assets)을 추가했다.
 * 3: 지역 SEO 칸(016 migration — 랜딩페이지 region·keyword·city·city_slug·main_image_alt·case_study,
 *    대기열 city·city_slug·main_image_url·main_image_alt·case_study)을 추가했다.
 * 2: landing_pages.published_at과 publishQueue(landing_page_queue)를 추가했다.
 * 1: 그 이전 형식.
 * 예전 형식도 계속 읽는다. 파일에 없는 칸은 복구할 때 쓰지 않아 현재 DB 값이 그대로 남는다.
 */
export const BACKUP_VERSION = 4 as const;
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2, 3, 4];

/** version 3부터 들어가는 랜딩페이지 칸 */
export const LANDING_PAGE_LOCAL_SEO_KEYS = [
  "region",
  "keyword",
  "city",
  "city_slug",
  "main_image_alt",
  "case_study",
] as const;

/** version 3부터 들어가는 대기열 칸 */
export const QUEUE_LOCAL_SEO_KEYS = [
  "city",
  "city_slug",
  "main_image_url",
  "main_image_alt",
  "case_study",
] as const;

/** version 4부터 들어가는 사진 2·3 칸(랜딩페이지·대기열 같음) */
export const PHOTO_KEYS = ["image_2_url", "image_2_alt", "image_3_url", "image_3_alt"] as const;

type LandingPageLocalSeoKey = (typeof LANDING_PAGE_LOCAL_SEO_KEYS)[number];
type QueueLocalSeoKey = (typeof QUEUE_LOCAL_SEO_KEYS)[number];
type PhotoKey = (typeof PHOTO_KEYS)[number];

/**
 * 백업 안의 랜딩페이지. version 1 파일에는 published_at 키가, version 1·2 파일에는
 * 지역 SEO 칸이 없다 — 없는 칸은 복구할 때 쓰지 않아 현재 DB 값이 그대로 남는다.
 */
export type BackupLandingPage = Omit<LandingPage, "published_at" | LandingPageLocalSeoKey | PhotoKey> & {
  published_at?: string | null;
} & Partial<Pick<LandingPage, LandingPageLocalSeoKey | PhotoKey>>;

/** 백업 안의 대기열 행. version 2 파일에는 지역 SEO 칸이, version 3 이하에는 사진 2·3 칸이 없다. */
export type BackupQueueRow = Omit<LandingPageQueueRow, QueueLocalSeoKey | PhotoKey> &
  Partial<Pick<LandingPageQueueRow, QueueLocalSeoKey | PhotoKey>>;

/** site_profile의 'default' row(version 4부터). 로고 포함 */
export interface BackupSiteProfile {
  business_name: string | null;
  description: string | null;
  phone: string | null;
  kakao_url: string | null;
  logo_url: string | null;
}

/** 사진 보관함 목록 한 행(version 4부터). 파일 자체는 백업에 넣지 않는다(주소만) */
export type BackupMediaAsset = MediaAsset;

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
  /** image2·image3: version 4부터 */
  kind: "logo" | "main" | "og" | "image2" | "image3";
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
  publishQueue: BackupQueueRow[];
  /** 대표 업체 정보(version 4부터). 그 전 파일이면 null — 복구할 때 현재 값을 그대로 둔다 */
  siteProfile: BackupSiteProfile | null;
  /** 사진 보관함 목록(version 4부터). 그 전 파일이면 빈 배열 */
  mediaAssets: BackupMediaAsset[];
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
