/** landing_page_seo_settings 테이블 row와 1:1로 대응하는 타입 */
export interface LandingPageSeoSettings {
  landing_page_id: string;
  seo_title: string | null;
  seo_description: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  seo_noindex: boolean;
  business_category: string | null;
  service_area: string | null;
  disable_auto_faq: boolean;
  created_at: string;
  updated_at: string;
}

/** 관리자 SEO 설정 폼 → Server Action에 전달되는 입력값 */
export interface UpdateSeoSettingsInput {
  seoTitle: string;
  seoDescription: string;
  ogTitle: string;
  ogDescription: string;
  businessCategory: string;
  serviceArea: string;
  seoNoindex: boolean;
  disableAutoFaq: boolean;
}

/** landing_page_faqs 테이블 row와 1:1로 대응하는 타입 */
export interface LandingPageFaq {
  id: string;
  landing_page_id: string;
  question: string;
  answer: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** 관리자 FAQ 생성 폼 → Server Action에 전달되는 입력값 */
export interface CreateFaqInput {
  question: string;
  answer: string;
}

/** 관리자 FAQ 수정 폼 → Server Action에 전달되는 입력값 */
export interface UpdateFaqInput {
  question: string;
  answer: string;
  isActive: boolean;
}

/** 화면에 실제로 표시되는(자동+수동, 중복 제거 완료) FAQ 1건 */
export interface ResolvedFaq {
  question: string;
  answer: string;
}
