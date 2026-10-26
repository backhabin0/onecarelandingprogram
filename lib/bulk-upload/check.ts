import {
  KEYWORD_REPEAT_LIMIT,
  LOCAL_SEO_MAX_LENGTH,
  SLUG_PATTERN,
  THIN_DESCRIPTION_MIN_LENGTH,
  validateFaqInput,
  validateLandingPageRows,
  type BulkLandingPageRowInput,
  type ValidationIssue,
} from "@/lib/landing-page-validation";
import { mockTemplates } from "@/lib/mock-data";
import type { LandingPageQueueFaq, LandingPageQueueState } from "@/types/publish-queue";
import { resolvePhotoReference, type MediaLibraryEntry } from "@/lib/media/library";
import { DEFAULT_UPLOAD_TEMPLATE, PHOTO_UPLOAD_FIELDS } from "./columns";
import type { UploadRow, UploadValues } from "./parse";
import {
  SimilarityIndex,
  roundSimilarity,
  similarityText,
  type SimilarityThresholds,
} from "./similarity";

/**
 * 대량 등록 행 검사. 브라우저(미리보기)와 서버(대기열 저장 직전 재검사)가 같은
 * 함수를 쓴다. 기본 규칙은 lib/landing-page-validation.ts의 validateLandingPageRows
 * 그대로이고, 여기서는 대량 등록에만 있는 칸(지역·키워드·FAQ 1~3)과
 * 대기열 중복, 문장 유사도를 더 본다.
 */

export interface CorpusEntry {
  keyword: string;
  /** similarityText()로 정규화한 대표 문구+소개 문구 */
  text: string;
  label: string;
}

export interface BulkCheckContext {
  /** landing_pages와 대기열에 이미 있는 slug */
  existingSlugs: Iterable<string>;
  /** 대기열에 이미 있는 (지역, 키워드) */
  existingPairs: Iterable<{ region: string; keyword: string }>;
  /** 같은 키워드의 기존 페이지·대기열 문구 */
  corpus: Iterable<CorpusEntry>;
  thresholds: SimilarityThresholds;
  /** 019: 사진 칸에 쓴 보관함 이름과 맞는 사진(이름 → 주소). 없으면 이름은 모두 "보관함에 없음" */
  mediaLibrary?: readonly MediaLibraryEntry[];
}

export type CheckedRowStatus = "pass" | "warning" | "error";

/** landing_page_queue에 넣을 값(state·batch_id·validation_errors 제외) */
export interface QueueRowInput {
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
  faqs: LandingPageQueueFaq[];
  city: string | null;
  city_slug: string | null;
  main_image_url: string | null;
  main_image_alt: string | null;
  case_study: string | null;
  image_2_url: string | null;
  image_2_alt: string | null;
  image_3_url: string | null;
  image_3_alt: string | null;
  max_similarity: number | null;
}

export interface CheckedUploadRow {
  rowNumber: number;
  status: CheckedRowStatus;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  similarity: { score: number; label: string } | null;
  /** 오류가 유사도 초과 하나뿐이라 hold로 저장할 수 있는 행 */
  holdable: boolean;
  queueRow: QueueRowInput;
}

export interface BulkCheckResult {
  rows: CheckedUploadRow[];
  passCount: number;
  warningCount: number;
  errorCount: number;
  holdableCount: number;
}

export const SIMILARITY_ERROR_CODE = "similarity_too_high";
const SIMILARITY_WARNING_CODE = "similarity_high";

const KNOWN_TEMPLATES = mockTemplates.map((t) => t.id);

/**
 * 소개 문구·FAQ에 들어 있으면 경고하는 사실 정보 패턴. AI가 지어낸 연락처·가격일
 * 수 있어 사람이 확인하게 한다(저장은 막지 않음 — 실제 업체 정보일 수도 있으므로).
 * - 전화번호: 010-1234-5678, 02)123-4567, 02 123 4567, 01012345678, 1588-1234, +82 10-...
 * - 금액·할인: 50,000원, 3만원, 5천 원, 1억, ₩10000, 30% 할인
 */
const PHONE_PATTERN =
  /\b0\d{1,2}[-.)\s]\s?\d{3,4}[-.\s]\d{4}\b|\+82[-\s]?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b|\b01[016789]\d{7,8}\b|\b1[5-9]\d{2}-\d{4}\b/;
const PRICE_PATTERN =
  /\d[\d,]*(?:\.\d+)?\s*(?:만|천|백|억)?\s*원|\d[\d,]*\s*억|₩\s*\d|\d+(?:\.\d+)?\s*%\s*(?:할인|off|OFF|Off)/;

const FACT_CHECK_FIELDS: { field: keyof UploadValues; label: string }[] = [
  { field: "description", label: "소개 문구" },
  ...([1, 2, 3] as const).flatMap((k) => [
    { field: `faqQuestion${k}` as const, label: `FAQ 질문${k}` },
    { field: `faqAnswer${k}` as const, label: `FAQ 답변${k}` },
  ]),
];

/** 소개 문구·FAQ에 전화번호·금액 패턴이 있으면 경고 */
export function collectFactWarnings(values: UploadValues): ValidationIssue[] {
  const phoneFields: string[] = [];
  const priceFields: string[] = [];
  for (const { field, label } of FACT_CHECK_FIELDS) {
    const text = values[field] ?? "";
    if (PHONE_PATTERN.test(text)) phoneFields.push(label);
    if (PRICE_PATTERN.test(text)) priceFields.push(label);
  }
  const fieldsOf = (labels: string[]) =>
    FACT_CHECK_FIELDS.filter((f) => labels.includes(f.label)).map((f) => f.field);
  const warnings: ValidationIssue[] = [];
  if (phoneFields.length > 0) {
    warnings.push({
      code: "contains_phone",
      fields: fieldsOf(phoneFields),
      message: `${phoneFields.join(", ")}에 전화번호로 보이는 내용이 있습니다. AI가 지어낸 번호가 아닌지 확인해주세요.`,
    });
  }
  if (priceFields.length > 0) {
    warnings.push({
      code: "contains_price",
      fields: fieldsOf(priceFields),
      message: `${priceFields.join(", ")}에 가격·할인으로 보이는 내용이 있습니다. 실제 정보인지 확인해주세요.`,
    });
  }
  return warnings;
}
const FAQ_INDEXES = [1, 2, 3] as const;

const v = (values: UploadValues, key: keyof UploadValues) => (values[key] ?? "").trim();
const orNull = (text: string) => (text ? text : null);
const pairKey = (region: string, keyword: string) => JSON.stringify([region, keyword]);
const percent = (score: number) => `${Math.floor(score * 100)}%`;

/** 행들의 사진 칸 값(대표 사진 URL·사진2·사진3) — 검사 전에 보관함 이름을 찾을 때 쓴다 */
export function collectPhotoValues(rows: readonly { values: UploadValues }[]): string[] {
  return rows.flatMap(({ values }) => PHOTO_UPLOAD_FIELDS.map(({ url }) => values[url] ?? "")).filter(Boolean);
}

/** slug 칸이 비어 있으면 `{region_slug}-{keyword_slug}` */
export function buildUploadSlug(values: UploadValues): string {
  const explicit = v(values, "slug");
  if (explicit) return explicit;
  const regionSlug = v(values, "regionSlug").toLowerCase();
  const keywordSlug = v(values, "keywordSlug").toLowerCase();
  return regionSlug && keywordSlug ? `${regionSlug}-${keywordSlug}` : "";
}

function collectFaqs(values: UploadValues, errors: ValidationIssue[]): LandingPageQueueFaq[] {
  const faqs: LandingPageQueueFaq[] = [];
  for (const k of FAQ_INDEXES) {
    const question = v(values, `faqQuestion${k}`);
    const answer = v(values, `faqAnswer${k}`);
    if (!question && !answer) continue;
    const { error } = validateFaqInput({ question, answer });
    if (error) {
      errors.push({
        code: "invalid_faq",
        fields: [`faqQuestion${k}`, `faqAnswer${k}`],
        message: `FAQ ${k}: ${error}`,
      });
      continue;
    }
    faqs.push({ question, answer });
  }
  return faqs;
}

function checkRegionKeyword(values: UploadValues, errors: ValidationIssue[]) {
  const missing = (["region", "keyword", "regionSlug", "keywordSlug"] as const).filter(
    (field) => !v(values, field)
  );
  if (missing.length > 0) {
    errors.push({
      code: "required",
      fields: [...missing],
      message: "지역, 키워드, region_slug, keyword_slug는 필수 입력값입니다.",
    });
  }
  for (const field of ["regionSlug", "keywordSlug"] as const) {
    const value = v(values, field).toLowerCase();
    if (value && !SLUG_PATTERN.test(value)) {
      errors.push({
        code: "invalid_slug",
        fields: [field],
        message: `${field === "regionSlug" ? "region_slug" : "keyword_slug"}는 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다.`,
      });
    }
  }
}

/**
 * 019: 사진 칸(대표 사진 URL·사진2·사진3) 해석. http(s) 주소는 그대로, 그 밖에는 사진 보관함 이름으로 찾는다.
 * 보관함에 없는 이름·주소 형식 오류는 오류로 남기고, 칸 이름(필드) → 저장할 주소를 돌려준다.
 */
function resolvePhotoFields(
  values: UploadValues,
  library: readonly MediaLibraryEntry[],
  errors: ValidationIssue[]
): Partial<Record<keyof UploadValues, string>> {
  const resolved: Partial<Record<keyof UploadValues, string>> = {};
  for (const { url: field, alt, label, urlSubject, altSubject } of PHOTO_UPLOAD_FIELDS) {
    const raw = v(values, field);
    if (v(values, alt).length > LOCAL_SEO_MAX_LENGTH.mainImageAlt) {
      errors.push({
        code: "too_long",
        fields: [alt],
        message: `${altSubject} ${LOCAL_SEO_MAX_LENGTH.mainImageAlt}자 이내로 입력해주세요.`,
      });
    }
    if (raw.length > LOCAL_SEO_MAX_LENGTH.mainImageUrl) {
      errors.push({
        code: "too_long",
        fields: [field],
        message: `${urlSubject} ${LOCAL_SEO_MAX_LENGTH.mainImageUrl}자 이내로 입력해주세요.`,
      });
      continue;
    }
    const reference = resolvePhotoReference(raw, library);
    switch (reference.kind) {
      case "url":
      case "library":
        resolved[field] = reference.url;
        break;
      case "invalid_url":
        errors.push({
          code: "invalid_url",
          fields: [field],
          message: `${urlSubject} http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다.`,
        });
        break;
      case "not_found":
        errors.push({
          code: "photo_not_found",
          fields: [field],
          message: `${label}: 사진 보관함에 "${reference.value}" 사진이 없습니다. 보관함에 먼저 올리거나 http(s) 주소를 써주세요.`,
        });
        break;
      case "ambiguous":
        errors.push({
          code: "photo_ambiguous",
          fields: [field],
          message: `${label}: "${reference.value}"와 이름이 맞는 사진이 여러 장입니다(${reference.names.join(", ")}). 확장자까지 정확히 써주세요.`,
        });
        break;
      default:
        break;
    }
  }
  return resolved;
}

/** 7단계 지역 SEO 칸: 시/군·city_slug(둘 다 또는 둘 다 비움), 글자 수(사진 칸은 resolvePhotoFields) */
function checkLocalSeoFields(values: UploadValues, errors: ValidationIssue[]) {
  const city = v(values, "city");
  const citySlug = v(values, "citySlug").toLowerCase();
  if (Boolean(city) !== Boolean(citySlug)) {
    errors.push({
      code: "required",
      fields: city ? ["citySlug"] : ["city"],
      message: "시/군과 city_slug는 함께 입력하거나 둘 다 비워 주세요.",
    });
  }
  if (citySlug && !SLUG_PATTERN.test(citySlug)) {
    errors.push({
      code: "invalid_slug",
      fields: ["citySlug"],
      message: "city_slug는 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다.",
    });
  }

  const lengthChecks: [keyof UploadValues, string, number][] = [
    ["region", "지역은", LOCAL_SEO_MAX_LENGTH.region],
    ["keyword", "키워드는", LOCAL_SEO_MAX_LENGTH.keyword],
    ["city", "시/군은", LOCAL_SEO_MAX_LENGTH.city],
    ["caseStudy", "현장 사례는", LOCAL_SEO_MAX_LENGTH.caseStudy],
  ];
  for (const [field, subject, max] of lengthChecks) {
    if (v(values, field).length > max) {
      errors.push({ code: "too_long", fields: [field], message: `${subject} ${max}자 이내로 입력해주세요.` });
    }
  }
}

/** 문자열 안에 keyword가 몇 번 나오는지(겹치지 않게, 대소문자 무시) */
export function countKeyword(text: string, keyword: string): number {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) {
    count += 1;
  }
  return count;
}

/**
 * AEO: FAQ 질문이 손님이 실제로 묻는 질문 문장인지(물음표로 끝나는지) 경고한다(저장은 막지 않음).
 * 검색·AI 답변 엔진은 질문-답 쌍을 그대로 인용하므로 "자료가 필요해요" 같은 평서문은 질문으로 읽히지 않는다.
 */
export function collectFaqQuestionWarnings(values: UploadValues): ValidationIssue[] {
  const notQuestions = FAQ_INDEXES.filter((k) => {
    const question = v(values, `faqQuestion${k}`);
    return question !== "" && !/[?？]$/.test(question);
  });
  if (notQuestions.length === 0) return [];
  return [
    {
      code: "faq_not_question",
      fields: notQuestions.map((k) => `faqQuestion${k}`),
      message: `${notQuestions.map((k) => `FAQ 질문${k}`).join(", ")}이(가) 물음표(?)로 끝나지 않습니다. 손님이 실제로 묻는 말투의 질문 문장으로 써 주세요.`,
    },
  ];
}

/**
 * 검색엔진 스팸으로 보일 수 있는 상태를 경고한다(저장은 막지 않음).
 * - 키워드 과다 반복: 대표 문구+소개 문구에 같은 키워드가 KEYWORD_REPEAT_LIMIT회 초과
 * - 얇은 페이지: 소개 문구가 THIN_DESCRIPTION_MIN_LENGTH자 미만이고 사진(1~3)·현장 사례가 모두 없음
 */
export function collectSeoQualityWarnings(values: UploadValues): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  const keyword = v(values, "keyword");
  const body = `${v(values, "heroText")}\n${v(values, "description")}`;
  const repeats = countKeyword(body, keyword);
  if (keyword && repeats > KEYWORD_REPEAT_LIMIT) {
    warnings.push({
      code: "keyword_overuse",
      fields: ["heroText", "description"],
      message: `대표·소개 문구에 키워드 "${keyword}"가 ${repeats}번 들어 있습니다(${KEYWORD_REPEAT_LIMIT}번 이하 권장). 억지 반복은 검색엔진에서 스팸으로 볼 수 있습니다.`,
    });
  }
  const description = v(values, "description");
  if (
    description.length < THIN_DESCRIPTION_MIN_LENGTH &&
    PHOTO_UPLOAD_FIELDS.every(({ url }) => !v(values, url)) &&
    !v(values, "caseStudy")
  ) {
    warnings.push({
      code: "thin_page",
      fields: ["description", "mainImageUrl", "image2Url", "image3Url", "caseStudy"],
      message: `내용이 적은 페이지입니다(소개 문구 ${description.length}자, 사진·현장 사례 없음). 소개 문구를 ${THIN_DESCRIPTION_MIN_LENGTH}자 이상으로 늘리거나 사진·현장 사례를 넣으면 검색 노출에 유리합니다.`,
    });
  }
  return warnings;
}

/**
 * 여러 행을 검사한다. 행 순서대로 처리하며, 유사도는 "같은 키워드의 기존
 * 페이지·대기열 + 이 파일에서 앞에 있는 행(유사도 외 오류가 없는 행)"과 비교한다.
 * 앞 행만 보는 이유: 서버가 나눠서 저장할 때도 앞 행이 먼저 대기열에 들어가므로
 * 미리보기와 실제 저장 결과가 같아진다.
 */
export function checkBulkUploadRows(
  rows: readonly UploadRow[],
  context: BulkCheckContext
): BulkCheckResult {
  const { thresholds } = context;

  const inputs: BulkLandingPageRowInput[] = rows.map(({ values }) => ({
    businessName: v(values, "businessName"),
    title: v(values, "title"),
    slug: buildUploadSlug(values),
    heroText: v(values, "heroText"),
    description: v(values, "description"),
    phone: v(values, "phone"),
    kakaoUrl: v(values, "kakaoUrl"),
    address: v(values, "address"),
    template: v(values, "template") || DEFAULT_UPLOAD_TEMPLATE,
    // 대기열 항목은 공개될 때 항상 public이 된다.
    status: "public",
    seo: { seoTitle: v(values, "seoTitle"), seoDescription: v(values, "seoDescription") },
  }));

  const base = validateLandingPageRows(inputs, {
    rowNumbers: rows.map((r) => r.rowNumber),
    existingSlugs: context.existingSlugs,
  });

  // (지역, 키워드) 중복: 파일 안 + 대기열
  const existingPairs = new Set(
    Array.from(context.existingPairs, (p) => pairKey(p.region.trim(), p.keyword.trim()))
  );
  const pairRows = new Map<string, number[]>();
  rows.forEach(({ values, rowNumber }) => {
    const region = v(values, "region");
    const keyword = v(values, "keyword");
    if (!region || !keyword) return;
    const key = pairKey(region, keyword);
    pairRows.set(key, [...(pairRows.get(key) ?? []), rowNumber]);
  });

  // 키워드별 유사도 색인(기존 문구로 시작)
  const indexes = new Map<string, SimilarityIndex>();
  const indexFor = (keyword: string) => {
    let index = indexes.get(keyword);
    if (!index) {
      index = new SimilarityIndex();
      indexes.set(keyword, index);
    }
    return index;
  };
  for (const entry of context.corpus) {
    indexFor(entry.keyword.trim()).add(entry.text, { label: entry.label });
  }

  const checked: CheckedUploadRow[] = rows.map((row, i) => {
    const { values, rowNumber } = row;
    const validated = base.rows[i];
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [...row.warnings];

    checkRegionKeyword(values, errors);
    checkLocalSeoFields(values, errors);
    const photoUrls = resolvePhotoFields(values, context.mediaLibrary ?? [], errors);
    errors.push(...validated.errors);
    warnings.push(...validated.warnings);

    const template = validated.normalized.template;
    if (template && !KNOWN_TEMPLATES.includes(template)) {
      errors.push({
        code: "unknown_template",
        fields: ["template"],
        message: `템플릿은 ${KNOWN_TEMPLATES.join(", ")} 중 하나여야 합니다.`,
      });
    }

    const faqs = collectFaqs(values, errors);
    warnings.push(...collectFactWarnings(values));
    warnings.push(...collectSeoQualityWarnings(values));
    warnings.push(...collectFaqQuestionWarnings(values));

    const region = v(values, "region");
    const keyword = v(values, "keyword");
    if (region && keyword) {
      const key = pairKey(region, keyword);
      const others = (pairRows.get(key) ?? []).filter((n) => n !== rowNumber);
      if (others.length > 0) {
        errors.push({
          code: "duplicate_pair_in_batch",
          fields: ["region", "keyword"],
          message: `같은 지역·키워드가 ${others.join(", ")}행에도 있습니다.`,
        });
      }
      if (existingPairs.has(key)) {
        errors.push({
          code: "pair_in_queue",
          fields: ["region", "keyword"],
          message: "같은 지역·키워드가 이미 대기열에 있습니다.",
        });
      }
    }

    // 문장 유사도
    const text = similarityText(validated.normalized.heroText, validated.normalized.description);
    let similarity: CheckedUploadRow["similarity"] = null;
    if (keyword && text) {
      const index = indexFor(keyword);
      const match = index.findMostSimilar(text);
      if (match) {
        similarity = { score: roundSimilarity(match.score), label: match.target.label };
        if (match.score >= thresholds.error) {
          errors.push({
            code: SIMILARITY_ERROR_CODE,
            fields: ["heroText", "description"],
            message: `대표·소개 문구가 ${match.target.label}과(와) ${percent(match.score)} 비슷합니다. (오류 기준 ${percent(thresholds.error)})`,
          });
        } else if (match.score >= thresholds.warning) {
          warnings.push({
            code: SIMILARITY_WARNING_CODE,
            fields: ["heroText", "description"],
            message: `대표·소개 문구가 ${match.target.label}과(와) ${percent(match.score)} 비슷합니다. (경고 기준 ${percent(thresholds.warning)})`,
          });
        }
      }
      const otherErrors = errors.some((e) => e.code !== SIMILARITY_ERROR_CODE);
      if (!otherErrors) {
        index.add(text, { label: `${rowNumber}행` });
      }
    }

    const holdable = errors.length > 0 && errors.every((e) => e.code === SIMILARITY_ERROR_CODE);
    const n = validated.normalized;

    return {
      rowNumber,
      status: errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "pass",
      errors,
      warnings,
      similarity,
      holdable,
      queueRow: {
        region,
        keyword,
        region_slug: v(values, "regionSlug").toLowerCase(),
        keyword_slug: v(values, "keywordSlug").toLowerCase(),
        business_name: n.businessName,
        title: n.title,
        slug: n.slug,
        hero_text: orNull(n.heroText),
        description: orNull(n.description),
        phone: orNull(n.phone),
        kakao_url: orNull(n.kakaoUrl),
        address: orNull(n.address),
        template: n.template,
        seo_title: orNull(v(values, "seoTitle")),
        seo_description: orNull(v(values, "seoDescription")),
        faqs,
        city: orNull(v(values, "city")),
        city_slug: orNull(v(values, "citySlug").toLowerCase()),
        // 사진 칸은 보관함 이름을 주소로 바꿔 저장한다(이름을 못 찾은 칸은 오류라 저장되지 않음).
        main_image_url: orNull(photoUrls.mainImageUrl ?? ""),
        main_image_alt: orNull(v(values, "mainImageAlt")),
        case_study: orNull(v(values, "caseStudy")),
        image_2_url: orNull(photoUrls.image2Url ?? ""),
        image_2_alt: orNull(v(values, "image2Alt")),
        image_3_url: orNull(photoUrls.image3Url ?? ""),
        image_3_alt: orNull(v(values, "image3Alt")),
        max_similarity: similarity?.score ?? null,
      },
    };
  });

  return {
    rows: checked,
    passCount: checked.filter((r) => r.status === "pass").length,
    warningCount: checked.filter((r) => r.status === "warning").length,
    errorCount: checked.filter((r) => r.status === "error").length,
    holdableCount: checked.filter((r) => r.holdable).length,
  };
}

/**
 * 저장할 상태를 정한다. 오류 없는 행은 ready, 유사도 오류만 있는 행은
 * holdSimilar를 선택했을 때만 hold, 나머지는 저장하지 않음(null).
 */
export function decideQueueState(
  row: CheckedUploadRow,
  holdSimilar: boolean
): Extract<LandingPageQueueState, "ready" | "hold"> | null {
  if (row.status !== "error") return "ready";
  if (row.holdable && holdSimilar) return "hold";
  return null;
}

/** validation_errors 컬럼에 남길 내용: 오류·경고를 level과 함께 */
export function issuesForStorage(row: CheckedUploadRow): (ValidationIssue & { level: "error" | "warning" })[] {
  return [
    ...row.errors.map((issue) => ({ ...issue, level: "error" as const })),
    ...row.warnings.map((issue) => ({ ...issue, level: "warning" as const })),
  ];
}
