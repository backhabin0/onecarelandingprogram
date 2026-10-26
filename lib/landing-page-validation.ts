import { BLOCKED_SLUG_PREFIX_MESSAGE, isReservedSlug, RESERVED_SLUGS } from "@/lib/slug";
import type {
  CreateLandingPageInput,
  LandingPagePhotosInput,
  LandingPageStatus,
  UpdateLandingPageInput,
} from "@/types/landing-page";
import type { CreateFaqInput, UpdateSeoSettingsInput } from "@/types/seo";

/**
 * 랜딩페이지 입력값 검증 규칙을 한 곳에 모은 파일.
 * 생성·수정·복제(app/admin/pages/actions.ts)와 앞으로 만들 대량 등록이 모두
 * 이 규칙을 쓴다. DB·서버 API에 의존하지 않는 순수 함수만 둔다("use server"
 * 파일에서는 async 함수만 export할 수 있어서 분리했다).
 */

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LANDING_PAGE_STATUSES: readonly LandingPageStatus[] = ["public", "private"];

/** 랜딩페이지 기본 정보 글자 수 제한(앞뒤 공백 제거 후 기준) */
export const LANDING_PAGE_MAX_LENGTH = {
  businessName: 100,
  title: 100,
  heroText: 200,
  description: 2000,
  phone: 30,
  address: 200,
  kakaoUrl: 500,
} as const;

/** SEO 설정 글자 수 제한(앞뒤 공백 제거 후 기준) */
export const SEO_MAX_LENGTH = {
  title: 120,
  description: 320,
  businessCategory: 100,
  serviceArea: 200,
} as const;

/** 지역 SEO 칸 글자 수 제한(016 migration의 DB 제약과 같음) */
export const LOCAL_SEO_MAX_LENGTH = {
  region: 50,
  keyword: 50,
  city: 50,
  mainImageUrl: 500,
  mainImageAlt: 200,
  caseStudy: 2000,
} as const;

/**
 * 얇은 페이지 기준: 소개 문구가 이 글자 수보다 짧고 대표 사진·현장 사례가 모두 없으면
 * 업로드 때 경고한다. 설정에서 "얇은 페이지 noindex"를 켜면 공개 함수(016)가 같은
 * 기준으로 noindex를 건다.
 */
export const THIN_DESCRIPTION_MIN_LENGTH = 200;

/** 소개 문구+대표 문구에서 같은 키워드가 이 횟수를 넘으면 과다 반복 경고 */
export const KEYWORD_REPEAT_LIMIT = 5;

/** FAQ 글자 수 제한(앞뒤 공백 제거 후 기준) */
export const FAQ_MAX_LENGTH = {
  question: 200,
  answer: 2000,
} as const;

const REQUIRED_MESSAGE = "업체명, 페이지 제목, URL Slug, 템플릿은 필수 입력값입니다.";

export function isValidLandingPageStatus(status: string): status is LandingPageStatus {
  return (LANDING_PAGE_STATUSES as readonly string[]).includes(status);
}

/**
 * http/https만 허용한다(javascript:/data:/file: 등 위험한 스킴 차단).
 * open.kakao.com 등 특정 호스트를 강제하지 않는 이유는 카카오 채널/오픈채팅
 * URL 형태가 바뀔 수 있어, 정상적인 서비스 URL 변화에 대응하기 위해서다.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ============================================================
// 랜딩페이지 기본 정보
// ============================================================

export interface NormalizedLandingPageInput {
  businessName: string;
  title: string;
  slug: string;
  template: string;
  heroText: string;
  description: string;
  phone: string;
  kakaoUrl: string;
  address: string;
}

export type LandingPageField = keyof NormalizedLandingPageInput | "status";

export type ValidationIssueCode =
  | "required"
  | "invalid_status"
  | "invalid_slug"
  | "reserved_slug"
  | "too_long"
  | "invalid_url"
  | "duplicate_slug_in_batch"
  | "slug_in_use"
  | "slug_normalized"
  | "non_kakao_url"
  // 아래는 대량 등록(lib/bulk-upload)에서만 쓰는 코드
  | "invalid_faq"
  | "unknown_template"
  | "duplicate_pair_in_batch"
  | "pair_in_queue"
  | "similarity_too_high"
  | "similarity_high"
  | "phone_number_cell"
  | "contains_phone"
  | "contains_price"
  | "keyword_overuse"
  | "thin_page"
  | "faq_not_question"
  // 019: 사진 칸에 쓴 보관함 이름을 못 찾음 / 같은 이름이 여러 장
  | "photo_not_found"
  | "photo_ambiguous";

export interface ValidationIssue {
  code: ValidationIssueCode;
  /** 문제가 된 입력 칸. 필수값 누락처럼 여러 칸이 함께 걸리면 여러 개 */
  fields: string[];
  message: string;
}

/** 검사 대상 필드. status는 CSV 등 외부 입력도 받을 수 있게 string으로 둔다. */
type LandingPageFieldsInput = Omit<CreateLandingPageInput, "status"> & {
  status: string;
};

export function normalizeLandingPageInput(
  input: Omit<LandingPageFieldsInput, "status">
): NormalizedLandingPageInput {
  return {
    businessName: input.businessName.trim(),
    title: input.title.trim(),
    slug: input.slug.trim().toLowerCase(),
    template: input.template.trim(),
    heroText: input.heroText.trim(),
    description: input.description.trim(),
    phone: input.phone.trim(),
    kakaoUrl: input.kakaoUrl.trim(),
    address: input.address.trim(),
  };
}

/** [필드, 오류 문구에 쓰는 이름(조사 포함)] — 글자 수 검사 순서(= 오류가 여러 개일 때 먼저 보이는 순서) */
const LENGTH_CHECKS: [Exclude<keyof typeof LANDING_PAGE_MAX_LENGTH, "kakaoUrl">, string][] = [
  ["businessName", "업체명은"],
  ["title", "페이지 제목은"],
  ["heroText", "대표 문구는"],
  ["description", "소개 문구는"],
  ["phone", "전화번호는"],
  ["address", "주소는"],
];

/**
 * 정규화된 값의 규칙 위반을 전부 모아서 돌려준다. 순서는 단건 검사에서
 * 사용자에게 보여주는 우선순위(필수값 → status → slug → 글자 수 → 카카오 URL)다.
 */
function collectNormalizedIssues(
  normalized: NormalizedLandingPageInput,
  status: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const missing = (["businessName", "title", "slug", "template"] as const).filter(
    (field) => !normalized[field]
  );
  if (missing.length > 0) {
    issues.push({ code: "required", fields: [...missing], message: REQUIRED_MESSAGE });
  }

  if (!isValidLandingPageStatus(status)) {
    issues.push({
      code: "invalid_status",
      fields: ["status"],
      message: "공개 상태 값이 올바르지 않습니다.",
    });
  }

  // 빈 slug는 필수값 누락으로 이미 걸렸으므로 형식 검사를 하지 않는다.
  if (normalized.slug) {
    if (!SLUG_PATTERN.test(normalized.slug)) {
      issues.push({
        code: "invalid_slug",
        fields: ["slug"],
        message:
          "URL Slug는 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다. 예: a-gym",
      });
    } else if (isReservedSlug(normalized.slug)) {
      // 예약어와 똑같으면 기존 문구, admin·login·api로 시작하기만 하면 이유를 알려 준다.
      issues.push({
        code: "reserved_slug",
        fields: ["slug"],
        message: RESERVED_SLUGS.includes(normalized.slug)
          ? "사용할 수 없는 URL입니다."
          : BLOCKED_SLUG_PREFIX_MESSAGE,
      });
    }
  }

  for (const [field, subject] of LENGTH_CHECKS) {
    const max = LANDING_PAGE_MAX_LENGTH[field];
    if (normalized[field].length > max) {
      issues.push({
        code: "too_long",
        fields: [field],
        message: `${subject} ${max}자 이내로 입력해주세요.`,
      });
    }
  }

  const { kakaoUrl } = normalized;
  if (kakaoUrl) {
    if (kakaoUrl.length > LANDING_PAGE_MAX_LENGTH.kakaoUrl) {
      issues.push({
        code: "too_long",
        fields: ["kakaoUrl"],
        message: `카카오톡 URL은 ${LANDING_PAGE_MAX_LENGTH.kakaoUrl}자 이내로 입력해주세요.`,
      });
    } else if (!isSafeExternalUrl(kakaoUrl)) {
      issues.push({
        code: "invalid_url",
        fields: ["kakaoUrl"],
        message:
          "카카오톡 URL은 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다.",
      });
    }
  }

  return issues;
}

/**
 * 랜딩페이지 생성·수정 입력값을 정규화하고 검증한다.
 * 규칙 위반이 여러 개여도 우선순위가 가장 높은 오류 문구 1개만 돌려준다.
 */
export function validateLandingPageInput(
  input: CreateLandingPageInput | UpdateLandingPageInput | LandingPageFieldsInput
): { normalized: NormalizedLandingPageInput; error?: string } {
  const normalized = normalizeLandingPageInput(input);
  const [first] = collectNormalizedIssues(normalized, input.status);
  return first ? { normalized, error: first.message } : { normalized };
}

export interface DuplicateLandingPageFields {
  businessName: string;
  title: string;
  slug: string;
  status: string;
}

/**
 * 복제 입력값(업체명·제목·slug·status)을 생성과 같은 규칙으로 검증한다.
 * 복제 화면에서 받지 않는 나머지 칸은 빈 값(템플릿은 기본값)으로 채워
 * 검사하므로, 그 칸들 때문에 오류가 나지 않는다.
 */
export function validateDuplicateLandingPageInput(input: DuplicateLandingPageFields): {
  normalized: Pick<NormalizedLandingPageInput, "businessName" | "title" | "slug">;
  error?: string;
} {
  const { normalized, error } = validateLandingPageInput({
    ...input,
    heroText: "",
    description: "",
    phone: "",
    kakaoUrl: "",
    address: "",
    template: "template-a",
  });
  const picked = {
    businessName: normalized.businessName,
    title: normalized.title,
    slug: normalized.slug,
  };
  return error ? { normalized: picked, error } : { normalized: picked };
}

// ============================================================
// 업체명 일괄 변경(랜딩페이지 목록·공개 대기열)
// ============================================================

/** 업체명 일괄 변경 요청 1번에 바꾸는 최대 항목 수. 화면은 이 크기로 나눠 순서대로 보낸다. */
export const BUSINESS_NAME_RENAME_CHUNK_SIZE = 100;

/**
 * 일괄 변경할 새 업체명 검사. 생성·수정과 같은 규칙(필수, 앞뒤 공백 제거 후 100자 이내)이며
 * 글자 수 오류 문구도 같다. 업체명 말고는 검사할 칸이 없어 필수 문구만 업체명 하나로 줄였다.
 */
export function validateBusinessNameInput(input: string): { value: string; error?: string } {
  const value = input.trim();
  if (!value) return { value, error: "업체명은 필수 입력값입니다." };
  if (value.length > LANDING_PAGE_MAX_LENGTH.businessName) {
    return { value, error: `업체명은 ${LANDING_PAGE_MAX_LENGTH.businessName}자 이내로 입력해주세요.` };
  }
  return { value };
}

// ============================================================
// 페이지 사진·로고(019)
// ============================================================

/** landing_pages 사진·로고 칸에 저장할 값(빈 칸은 null) */
export interface NormalizedLandingPagePhotos {
  logo_url: string | null;
  main_image_url: string | null;
  main_image_alt: string | null;
  image_2_url: string | null;
  image_2_alt: string | null;
  image_3_url: string | null;
  image_3_alt: string | null;
}

const PHOTO_URL_FIELDS: [keyof LandingPagePhotosInput, string][] = [
  ["logoUrl", "로고"],
  ["mainImageUrl", "사진1"],
  ["image2Url", "사진2"],
  ["image3Url", "사진3"],
];
const PHOTO_ALT_FIELDS: [keyof LandingPagePhotosInput, string][] = [
  ["mainImageAlt", "사진1 설명은"],
  ["image2Alt", "사진2 설명은"],
  ["image3Alt", "사진3 설명은"],
];

/**
 * 페이지 사진·로고 입력 검사: 주소는 비우거나 http(s) 500자 이내, 설명은 200자 이내.
 * 서버(Server Action)가 브라우저 값을 믿지 않고 다시 부른다.
 */
export function validateLandingPagePhotosInput(input: unknown): {
  normalized: NormalizedLandingPagePhotos | null;
  error?: string;
} {
  if (typeof input !== "object" || input === null) return { normalized: null, error: "잘못된 요청입니다." };
  const record = input as Record<string, unknown>;
  const value = (key: keyof LandingPagePhotosInput) => {
    const raw = record[key];
    return typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : null;
  };
  for (const [key] of [...PHOTO_URL_FIELDS, ...PHOTO_ALT_FIELDS]) {
    if (value(key) === null) return { normalized: null, error: "잘못된 요청입니다." };
  }
  for (const [key, label] of PHOTO_URL_FIELDS) {
    const url = value(key) as string;
    if (url.length > LOCAL_SEO_MAX_LENGTH.mainImageUrl) {
      return { normalized: null, error: `${label} 주소는 ${LOCAL_SEO_MAX_LENGTH.mainImageUrl}자 이내여야 합니다.` };
    }
    if (url && !isSafeExternalUrl(url)) {
      return { normalized: null, error: `${label} 주소는 http:// 또는 https://로 시작해야 합니다.` };
    }
  }
  for (const [key, subject] of PHOTO_ALT_FIELDS) {
    if ((value(key) as string).length > LOCAL_SEO_MAX_LENGTH.mainImageAlt) {
      return { normalized: null, error: `${subject} ${LOCAL_SEO_MAX_LENGTH.mainImageAlt}자 이내로 입력해주세요.` };
    }
  }
  const orNull = (key: keyof LandingPagePhotosInput) => (value(key) as string) || null;
  return {
    normalized: {
      logo_url: orNull("logoUrl"),
      main_image_url: orNull("mainImageUrl"),
      main_image_alt: orNull("mainImageAlt"),
      image_2_url: orNull("image2Url"),
      image_2_alt: orNull("image2Alt"),
      image_3_url: orNull("image3Url"),
      image_3_alt: orNull("image3Alt"),
    },
  };
}

// ============================================================
// SEO 설정
// ============================================================

type SeoTextFields = Pick<
  UpdateSeoSettingsInput,
  "seoTitle" | "seoDescription" | "ogTitle" | "ogDescription" | "businessCategory" | "serviceArea"
>;

/** [필드, 오류 문구에 쓰는 이름(조사 포함), 제한값] — 검사 순서 */
const SEO_LENGTH_CHECKS: [keyof SeoTextFields, string, number][] = [
  ["seoTitle", "SEO 제목은", SEO_MAX_LENGTH.title],
  ["ogTitle", "OG 제목은", SEO_MAX_LENGTH.title],
  ["seoDescription", "SEO 설명은", SEO_MAX_LENGTH.description],
  ["ogDescription", "OG 설명은", SEO_MAX_LENGTH.description],
  ["businessCategory", "업종/카테고리는", SEO_MAX_LENGTH.businessCategory],
  ["serviceArea", "서비스 지역은", SEO_MAX_LENGTH.serviceArea],
];

/** SEO 텍스트 칸의 글자 수 위반을 전부 모은다. 빠진 칸은 빈 값으로 본다. */
function collectSeoIssues(input: Partial<SeoTextFields>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [field, subject, max] of SEO_LENGTH_CHECKS) {
    if ((input[field] ?? "").trim().length > max) {
      issues.push({
        code: "too_long",
        fields: [field],
        message: `${subject} ${max}자 이내로 입력해주세요.`,
      });
    }
  }
  return issues;
}

export function validateSeoSettingsInput(input: UpdateSeoSettingsInput): { error?: string } {
  const [first] = collectSeoIssues(input);
  return first ? { error: first.message } : {};
}

// ============================================================
// FAQ
// ============================================================

export function validateFaqInput(input: CreateFaqInput): { error?: string } {
  const question = input.question.trim();
  const answer = input.answer.trim();

  if (!question || !answer) {
    return { error: "질문과 답변을 모두 입력해주세요." };
  }
  if (question.length > FAQ_MAX_LENGTH.question) {
    return { error: `질문은 ${FAQ_MAX_LENGTH.question}자 이내로 입력해주세요.` };
  }
  if (answer.length > FAQ_MAX_LENGTH.answer) {
    return { error: `답변은 ${FAQ_MAX_LENGTH.answer}자 이내로 입력해주세요.` };
  }
  return {};
}

// ============================================================
// 대량 등록(여러 행 한 번에 검사) — 아직 화면에 연결하지 않음
// ============================================================

/** 대량 등록 1행. CSV처럼 칸이 비어 있거나 빠질 수 있어 전부 선택값으로 받는다. */
export interface BulkLandingPageRowInput {
  businessName?: string;
  title?: string;
  slug?: string;
  heroText?: string;
  description?: string;
  phone?: string;
  kakaoUrl?: string;
  address?: string;
  template?: string;
  status?: string;
  /** 함께 등록할 SEO 설정(선택). 글자 수 제한은 SEO 설정 화면과 같다. */
  seo?: Partial<SeoTextFields>;
}

export interface BulkRowValidationResult {
  /** 사용자에게 보여줄 행 번호(rowNumbers를 주면 그 값, 아니면 firstRowNumber부터 1씩 증가) */
  rowNumber: number;
  normalized: NormalizedLandingPageInput & { status: string };
  /** 하나라도 있으면 이 행은 등록할 수 없다 */
  errors: ValidationIssue[];
  /** 등록은 가능하지만 확인이 필요한 내용 */
  warnings: ValidationIssue[];
}

export interface BulkValidationResult {
  rows: BulkRowValidationResult[];
  validCount: number;
  errorCount: number;
  warningCount: number;
}

export interface BulkValidationOptions {
  /**
   * 첫 행의 번호. CSV처럼 1행이 머리글이면 2를 넘긴다. 기본값 1.
   */
  firstRowNumber?: number;
  /**
   * 행마다 보여줄 번호를 직접 지정한다(rows와 같은 길이). 빈 줄을 건너뛴
   * 엑셀처럼 번호가 연속되지 않을 때 쓴다. 주면 firstRowNumber는 무시한다.
   */
  rowNumbers?: readonly number[];
  /** DB에 이미 있는 slug 목록. 주면 겹치는 행을 오류로 표시한다(소문자 기준 비교). */
  existingSlugs?: Iterable<string>;
}

function isKakaoHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "kakao.com" || host.endsWith(".kakao.com");
  } catch {
    return false;
  }
}

/**
 * 여러 행을 한 번에 검사해서 행 번호별 오류/경고 목록을 돌려준다.
 *
 * - 각 행에는 생성 화면과 같은 규칙(validateLandingPageInput)을 적용하되,
 *   첫 번째 오류에서 멈추지 않고 모든 위반을 errors에 모은다.
 * - 같은 묶음 안에서 slug가 겹치면 겹치는 모든 행에 오류를 단다.
 * - existingSlugs를 주면 이미 DB에 있는 slug도 오류로 표시한다.
 *   (실제 저장 시 DB unique 제약이 최종 판단이므로, 여기서는 사전 안내용)
 * - 경고: slug를 소문자/공백 제거로 바꿔 저장하게 되는 경우, 카카오톡 URL이
 *   kakao.com 주소가 아닌 경우(규칙상 허용되지만 오타일 수 있음).
 */
export function validateLandingPageRows(
  rows: readonly BulkLandingPageRowInput[],
  options: BulkValidationOptions = {}
): BulkValidationResult {
  const firstRowNumber = options.firstRowNumber ?? 1;
  if (options.rowNumbers && options.rowNumbers.length !== rows.length) {
    throw new Error("rowNumbers의 길이는 rows와 같아야 합니다.");
  }
  const rowNumberAt = (index: number) => options.rowNumbers?.[index] ?? firstRowNumber + index;
  const existing = new Set(
    Array.from(options.existingSlugs ?? [], (slug) => slug.trim().toLowerCase())
  );

  const results: BulkRowValidationResult[] = rows.map((row, index) => {
    const rawSlug = row.slug ?? "";
    const status = (row.status ?? "").trim();
    const normalized = normalizeLandingPageInput({
      businessName: row.businessName ?? "",
      title: row.title ?? "",
      slug: rawSlug,
      template: row.template ?? "",
      heroText: row.heroText ?? "",
      description: row.description ?? "",
      phone: row.phone ?? "",
      kakaoUrl: row.kakaoUrl ?? "",
      address: row.address ?? "",
    });

    const errors = [
      ...collectNormalizedIssues(normalized, status),
      ...collectSeoIssues(row.seo ?? {}),
    ];
    const warnings: ValidationIssue[] = [];
    const slugHasError = errors.some((issue) => issue.fields.includes("slug"));

    if (!slugHasError && normalized.slug && existing.has(normalized.slug)) {
      errors.push({ code: "slug_in_use", fields: ["slug"], message: "이미 사용 중인 URL입니다." });
    }

    if (!slugHasError && normalized.slug && rawSlug !== normalized.slug) {
      warnings.push({
        code: "slug_normalized",
        fields: ["slug"],
        message: `URL Slug를 "${normalized.slug}"(으)로 바꿔서 저장합니다.`,
      });
    }

    const kakaoHasError = errors.some((issue) => issue.fields.includes("kakaoUrl"));
    if (!kakaoHasError && normalized.kakaoUrl && !isKakaoHost(normalized.kakaoUrl)) {
      warnings.push({
        code: "non_kakao_url",
        fields: ["kakaoUrl"],
        message: "카카오톡 URL이 kakao.com 주소가 아닙니다. 맞는 주소인지 확인해주세요.",
      });
    }

    return {
      rowNumber: rowNumberAt(index),
      normalized: { ...normalized, status },
      errors,
      warnings,
    };
  });

  // 같은 묶음 안의 slug 중복. 형식 오류가 없는 slug끼리만 비교한다.
  const rowsBySlug = new Map<string, BulkRowValidationResult[]>();
  for (const result of results) {
    const { slug } = result.normalized;
    const slugInvalid = result.errors.some(
      (issue) => issue.code !== "slug_in_use" && issue.fields.includes("slug")
    );
    if (!slug || slugInvalid) {
      continue;
    }
    rowsBySlug.set(slug, [...(rowsBySlug.get(slug) ?? []), result]);
  }
  for (const group of rowsBySlug.values()) {
    if (group.length < 2) continue;
    for (const result of group) {
      const others = group
        .filter((other) => other !== result)
        .map((other) => other.rowNumber)
        .join(", ");
      result.errors.push({
        code: "duplicate_slug_in_batch",
        fields: ["slug"],
        message: `같은 URL Slug가 ${others}행에도 있습니다.`,
      });
    }
  }

  const errorCount = results.filter((result) => result.errors.length > 0).length;
  return {
    rows: results,
    validCount: results.length - errorCount,
    errorCount,
    warningCount: results.filter((result) => result.warnings.length > 0).length,
  };
}
