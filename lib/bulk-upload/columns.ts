/**
 * 대량 등록 엑셀/CSV 양식의 열 정의. 양식 다운로드와 업로드 파싱이 모두 이
 * 목록을 쓴다. 업로드할 때는 열 순서가 아니라 첫 줄 머리글 이름으로 찾는다.
 */

export type BulkUploadField =
  | "region"
  | "keyword"
  | "regionSlug"
  | "keywordSlug"
  | "businessName"
  | "title"
  | "heroText"
  | "description"
  | "phone"
  | "kakaoUrl"
  | "address"
  | "template"
  | "seoTitle"
  | "seoDescription"
  | "faqQuestion1"
  | "faqAnswer1"
  | "faqQuestion2"
  | "faqAnswer2"
  | "faqQuestion3"
  | "faqAnswer3"
  | "city"
  | "citySlug"
  | "mainImageUrl"
  | "mainImageAlt"
  | "caseStudy"
  | "image2Url"
  | "image2Alt"
  | "image3Url"
  | "image3Alt"
  | "slug";

export interface BulkUploadColumn {
  field: BulkUploadField;
  header: string;
  /** 양식 예시 행의 값 */
  example: string;
  /** 엑셀 양식 열 너비(글자 수 기준) */
  width: number;
}

/** 양식에 들어가는 열(순서 그대로) */
export const BULK_UPLOAD_COLUMNS: readonly BulkUploadColumn[] = [
  { field: "region", header: "지역", example: "강남", width: 10 },
  { field: "keyword", header: "키워드", example: "헬스장", width: 10 },
  { field: "regionSlug", header: "region_slug", example: "gangnam", width: 14 },
  { field: "keywordSlug", header: "keyword_slug", example: "gym", width: 14 },
  { field: "businessName", header: "업체명", example: "원케어 헬스 강남점", width: 18 },
  { field: "title", header: "페이지 제목", example: "강남 헬스장 원케어 헬스", width: 24 },
  {
    field: "heroText",
    header: "대표 문구",
    example: "강남역 3분, 1:1 맞춤 PT로 시작하세요",
    width: 30,
  },
  {
    field: "description",
    header: "소개 문구",
    example: "강남역 인근에서 10년째 운영 중인 헬스장입니다. 체형 분석 후 개인별 운동 계획을 세워 드립니다.",
    width: 40,
  },
  { field: "phone", header: "전화", example: "010-1234-5678", width: 15 },
  { field: "kakaoUrl", header: "카카오 URL", example: "https://open.kakao.com/o/example", width: 30 },
  { field: "address", header: "주소", example: "서울 강남구 테헤란로 1", width: 24 },
  { field: "template", header: "템플릿", example: "template-a", width: 12 },
  { field: "seoTitle", header: "SEO 제목", example: "강남 헬스장 | 원케어 헬스", width: 24 },
  {
    field: "seoDescription",
    header: "SEO 설명",
    example: "강남역 3분 거리 헬스장. 1:1 맞춤 PT와 체형 분석을 제공합니다.",
    width: 36,
  },
  { field: "faqQuestion1", header: "FAQ 질문1", example: "주차가 가능한가요?", width: 20 },
  { field: "faqAnswer1", header: "FAQ 답변1", example: "건물 지하 주차장을 2시간 무료로 이용할 수 있습니다.", width: 30 },
  { field: "faqQuestion2", header: "FAQ 질문2", example: "", width: 20 },
  { field: "faqAnswer2", header: "FAQ 답변2", example: "", width: 30 },
  { field: "faqQuestion3", header: "FAQ 질문3", example: "", width: 20 },
  { field: "faqAnswer3", header: "FAQ 답변3", example: "", width: 30 },
  // 7단계에서 추가한 칸. 예전 양식(이 칸 없음)도 그대로 읽을 수 있도록 맨 뒤에 둔다
  // (머리글 없이 붙여넣은 표도 앞 20칸은 예전과 같은 순서로 읽힌다).
  { field: "city", header: "시/군", example: "강남구", width: 10 },
  { field: "citySlug", header: "city_slug", example: "gangnam-gu", width: 14 },
  { field: "mainImageUrl", header: "대표 사진 URL", example: "", width: 30 },
  { field: "mainImageAlt", header: "사진 설명(alt)", example: "", width: 24 },
  { field: "caseStudy", header: "현장 사례", example: "", width: 40 },
  // 사진 기능(019)에서 추가한 칸. 역시 맨 뒤에 둬서 예전 양식·붙여넣기 순서가 그대로 읽힌다.
  // 사진 칸(대표 사진 URL·사진2·사진3)에는 사진 보관함 이름 또는 http(s) 주소를 쓴다.
  { field: "image2Url", header: "사진2", example: "", width: 24 },
  { field: "image2Alt", header: "사진2 설명", example: "", width: 24 },
  { field: "image3Url", header: "사진3", example: "", width: 24 },
  { field: "image3Alt", header: "사진3 설명", example: "", width: 24 },
];

/** 사진 칸(보관함 이름 또는 주소)과 그 설명 칸 — 사진1 = 대표 사진 */
export const PHOTO_UPLOAD_FIELDS: readonly {
  url: BulkUploadField;
  alt: BulkUploadField;
  label: string;
  /** 오류 문구 주어(대표 사진은 예전 문구 그대로) */
  urlSubject: string;
  altSubject: string;
}[] = [
  { url: "mainImageUrl", alt: "mainImageAlt", label: "대표 사진", urlSubject: "대표 사진 URL은", altSubject: "사진 설명(alt)은" },
  { url: "image2Url", alt: "image2Alt", label: "사진2", urlSubject: "사진2 주소는", altSubject: "사진2 설명은" },
  { url: "image3Url", alt: "image3Alt", label: "사진3", urlSubject: "사진3 주소는", altSubject: "사진3 설명은" },
];

/** 손님이 직접 채우는 칸(프롬프트 만들기에서 AI가 채우지 않고 빈칸으로 둠) */
export const CUSTOMER_ONLY_FIELDS: readonly BulkUploadField[] = [
  "city",
  "citySlug",
  "mainImageUrl",
  "mainImageAlt",
  "caseStudy",
  "image2Url",
  "image2Alt",
  "image3Url",
  "image3Alt",
];

/**
 * 양식에는 없지만 머리글로 넣으면 인식하는 선택 열.
 * 비어 있으면 slug는 `{region_slug}-{keyword_slug}`로 만든다.
 */
export const OPTIONAL_UPLOAD_COLUMNS: readonly BulkUploadColumn[] = [
  { field: "slug", header: "URL Slug", example: "", width: 20 },
];

/** 이 머리글이 하나라도 없으면 파일 전체를 거부한다 */
export const REQUIRED_UPLOAD_HEADERS: readonly BulkUploadField[] = [
  "region",
  "keyword",
  "regionSlug",
  "keywordSlug",
  "businessName",
  "title",
];

export const BULK_UPLOAD_TEMPLATE_FILENAME = "onecare-bulk-upload-template.xlsx";

/** 템플릿 칸이 비어 있으면 쓰는 값(관리자 생성 폼의 기본 선택과 같음) */
export const DEFAULT_UPLOAD_TEMPLATE = "template-a";

/** 머리글 비교용: 앞뒤 공백·대소문자·중간 공백 차이를 무시한다 */
export function normalizeHeader(header: string): string {
  return header.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}
