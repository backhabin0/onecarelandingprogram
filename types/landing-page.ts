export type LandingPageStatus = "public" | "private";

/** landing_pages 테이블 row와 1:1로 대응하는 타입 */
export interface LandingPage {
  id: string;
  business_name: string;
  title: string;
  slug: string;
  hero_text: string | null;
  description: string | null;
  phone: string | null;
  kakao_url: string | null;
  address: string | null;
  logo_url: string | null;
  main_image_url: string | null;
  template: string;
  status: LandingPageStatus;
  created_at: string;
  updated_at: string;
}

/** 새 랜딩페이지 생성 폼 → Server Action에 전달되는 입력값 */
export interface CreateLandingPageInput {
  businessName: string;
  title: string;
  slug: string;
  heroText: string;
  description: string;
  phone: string;
  kakaoUrl: string;
  address: string;
  template: string;
  status: LandingPageStatus;
}

/** 랜딩페이지 수정 폼 → Server Action에 전달되는 입력값 */
export interface UpdateLandingPageInput {
  businessName: string;
  title: string;
  slug: string;
  heroText: string;
  description: string;
  phone: string;
  kakaoUrl: string;
  address: string;
  template: string;
  status: LandingPageStatus;
}

export interface Template {
  id: string;
  name: string;
  description: string;
}
