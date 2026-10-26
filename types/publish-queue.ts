/** landing_page_queue.state (013 migration) */
export type LandingPageQueueState = "draft" | "ready" | "hold" | "published" | "failed";

export const LANDING_PAGE_QUEUE_STATES: readonly LandingPageQueueState[] = [
  "draft",
  "ready",
  "hold",
  "published",
  "failed",
];

/** landing_page_queue.source — AI 생성 / 엑셀 업로드 */
export type LandingPageQueueSource = "ai" | "excel";

export const LANDING_PAGE_QUEUE_SOURCES: readonly LandingPageQueueSource[] = ["ai", "excel"];

export interface LandingPageQueueFaq {
  question: string;
  answer: string;
}

/** landing_page_queue 테이블 row와 1:1로 대응하는 타입 */
export interface LandingPageQueueRow {
  id: string;
  region: string;
  keyword: string;
  region_slug: string;
  keyword_slug: string;
  business_name: string;
  title: string;
  slug: string;
  hero_text: string | null;
  description: string | null;
  phone: string | null;
  kakao_url: string | null;
  address: string | null;
  template: string;
  seo_title: string | null;
  seo_description: string | null;
  service_area: string | null;
  business_category: string | null;
  faqs: LandingPageQueueFaq[];
  /** 016: 시/군, 대표 사진, 현장 사례(손님이 직접 작성) */
  city: string | null;
  city_slug: string | null;
  main_image_url: string | null;
  main_image_alt: string | null;
  case_study: string | null;
  /** 019: 사진 2·3과 설명 */
  image_2_url: string | null;
  image_2_alt: string | null;
  image_3_url: string | null;
  image_3_alt: string | null;
  source: LandingPageQueueSource;
  state: LandingPageQueueState;
  /** 앱 검증 결과나 공개 실패 사유(배열). 형식은 lib/landing-page-validation.ts의 ValidationIssue */
  validation_errors: unknown[];
  /** 기존 페이지와의 최대 유사도 0~1. 계산 전에는 null */
  max_similarity: number | null;
  priority: number;
  published_at: string | null;
  landing_page_id: string | null;
  batch_id: string | null;
  created_at: string;
}
