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
  /** 대기열에서 공개된 시각(013 migration). 관리자가 직접 만든 페이지와 기존 페이지는 null */
  published_at: string | null;
  /** 016: 지역 SEO용 칸. 대기열에서 공개된 페이지에만 값이 있고, 그 밖에는 null */
  region: string | null;
  keyword: string | null;
  city: string | null;
  city_slug: string | null;
  main_image_alt: string | null;
  case_study: string | null;
  /** 019: 사진 2·3과 설명(사진 1 = main_image_url / main_image_alt) */
  image_2_url: string | null;
  image_2_alt: string | null;
  image_3_url: string | null;
  image_3_alt: string | null;
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
  features: string[];
  available: boolean;
}

/**
 * 현재 지원하는 템플릿 id의 union 타입.
 * DB의 template 컬럼 자체는 자유 문자열이므로(향후 template-c 등 확장 대비),
 * 이 타입은 템플릿 렌더러 매핑처럼 "알려진 템플릿"을 다루는 곳에서만 사용한다.
 */
export type LandingPageTemplateId = "template-a" | "template-b";

/**
 * 019: 페이지 사진·로고 입력(사진 보관함 주소 또는 외부 주소). 사진 1 = main_image_url.
 * 빈 문자열은 "없음"(null)으로 저장한다.
 */
export interface LandingPagePhotosInput {
  logoUrl: string;
  mainImageUrl: string;
  mainImageAlt: string;
  image2Url: string;
  image2Alt: string;
  image3Url: string;
  image3Alt: string;
}
