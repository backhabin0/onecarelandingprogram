"use server";

import { revalidatePath } from "next/cache";
import {
  deleteLandingPage,
  duplicateLandingPage,
  insertLandingPage,
  updateLandingPage,
  updateLandingPageImageUrl,
  updateLandingPageStatus,
  type LandingPageImageField,
} from "@/lib/landing-pages";
import {
  resetSeoOverrides,
  updateSeoOgImageUrl,
  upsertSeoSettings,
} from "@/lib/seo-settings";
import {
  createFaq,
  deleteFaq,
  moveFaq,
  updateFaq,
  type FaqMoveDirection,
} from "@/lib/faqs";
import type {
  CreateLandingPageInput,
  LandingPageStatus,
  UpdateLandingPageInput,
} from "@/types/landing-page";
import type {
  CreateFaqInput,
  UpdateFaqInput,
  UpdateSeoSettingsInput,
} from "@/types/seo";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_STATUSES: LandingPageStatus[] = ["public", "private"];

const SEO_TITLE_MAX_LENGTH = 120;
const SEO_DESCRIPTION_MAX_LENGTH = 320;
const BUSINESS_CATEGORY_MAX_LENGTH = 100;
const SERVICE_AREA_MAX_LENGTH = 200;
const FAQ_QUESTION_MAX_LENGTH = 200;
const FAQ_ANSWER_MAX_LENGTH = 2000;

/** SEO/FAQ 관련 화면에 영향을 주는 경로를 한 번에 갱신한다. */
function revalidateSeoPaths(landingPageId: string, slug: string) {
  revalidatePath(`/admin/pages/${landingPageId}/edit`);
  revalidatePath(`/${slug}`);
}

interface NormalizedInput {
  businessName: string;
  title: string;
  slug: string;
  template: string;
}

function normalizeAndValidate(
  input: CreateLandingPageInput | UpdateLandingPageInput
): { normalized: NormalizedInput; error?: string } {
  const businessName = input.businessName.trim();
  const title = input.title.trim();
  const slug = input.slug.trim().toLowerCase();
  const template = input.template.trim();

  const normalized = { businessName, title, slug, template };

  if (!businessName || !title || !slug || !template) {
    return {
      normalized,
      error: "업체명, 페이지 제목, URL Slug, 템플릿은 필수 입력값입니다.",
    };
  }

  if (!VALID_STATUSES.includes(input.status)) {
    return { normalized, error: "공개 상태 값이 올바르지 않습니다." };
  }

  if (!SLUG_PATTERN.test(slug)) {
    return {
      normalized,
      error:
        "URL Slug는 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다. 예: a-gym",
    };
  }

  return { normalized };
}

export interface CreateLandingPageResult {
  success: boolean;
  error?: string;
  id?: string;
}

export async function createLandingPageAction(
  input: CreateLandingPageInput
): Promise<CreateLandingPageResult> {
  const { normalized, error } = normalizeAndValidate(input);

  if (error) {
    return { success: false, error };
  }

  const result = await insertLandingPage({
    ...input,
    ...normalized,
  });

  if (result.success) {
    revalidatePath("/admin/pages");
    revalidatePath("/admin");
  }

  return result;
}

export interface UpdateLandingPageResult {
  success: boolean;
  error?: string;
}

export async function updateLandingPageAction(
  id: string,
  input: UpdateLandingPageInput
): Promise<UpdateLandingPageResult> {
  if (!id) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const { normalized, error } = normalizeAndValidate(input);

  if (error) {
    return { success: false, error };
  }

  const result = await updateLandingPage(id, {
    ...input,
    ...normalized,
  });

  if (result.success) {
    revalidatePath("/admin/pages");
    revalidatePath("/admin");
  }

  return result;
}

export interface DeleteLandingPageResult {
  success: boolean;
  error?: string;
}

export async function deleteLandingPageAction(
  id: string
): Promise<DeleteLandingPageResult> {
  if (!id) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await deleteLandingPage(id);

  if (result.success) {
    revalidatePath("/admin/pages");
    revalidatePath("/admin");
  }

  return result;
}

export interface DuplicateLandingPageInput {
  businessName: string;
  title: string;
  slug: string;
  status: LandingPageStatus;
}

export interface DuplicateLandingPageActionResult {
  success: boolean;
  error?: string;
  id?: string;
}

/**
 * 원본 랜딩페이지를 새 row로 복제한다. 입력값 검증은 create/edit과 동일한
 * normalizeAndValidate 규칙(slug 패턴, 필수값, status)을 재사용한다.
 * 실제 복제(기본 데이터/SEO/FAQ 복사, consultation/Analytics 제외, rollback)는
 * lib/landing-pages.ts의 duplicateLandingPage가 담당한다.
 */
export async function duplicateLandingPageAction(
  sourceId: string,
  input: DuplicateLandingPageInput
): Promise<DuplicateLandingPageActionResult> {
  if (!sourceId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const { normalized, error } = normalizeAndValidate({
    ...input,
    heroText: "",
    description: "",
    phone: "",
    kakaoUrl: "",
    address: "",
    template: "template-a",
  });

  if (error) {
    return { success: false, error };
  }

  const result = await duplicateLandingPage(sourceId, {
    businessName: normalized.businessName,
    title: normalized.title,
    slug: normalized.slug,
    status: input.status,
  });

  if (result.success) {
    revalidatePath("/admin/pages");
    revalidatePath("/admin");
  }

  return result;
}

export interface ToggleLandingPageStatusResult {
  success: boolean;
  error?: string;
}

export async function toggleLandingPageStatusAction(
  id: string,
  status: LandingPageStatus
): Promise<ToggleLandingPageStatusResult> {
  if (!id) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  if (!VALID_STATUSES.includes(status)) {
    return { success: false, error: "공개 상태 값이 올바르지 않습니다." };
  }

  const result = await updateLandingPageStatus(id, status);

  if (result.success) {
    revalidatePath("/admin/pages");
    revalidatePath("/admin");
  }

  return result;
}

export interface UpdateLandingPageImageResult {
  success: boolean;
  error?: string;
}

const VALID_IMAGE_FIELDS: LandingPageImageField[] = ["logo_url", "main_image_url"];

/**
 * logo_url / main_image_url을 갱신한다.
 * 실제 파일 업로드/삭제는 브라우저에서 Supabase Storage로 직접 처리되고,
 * 이 action은 결과 public URL(또는 null)을 DB에 반영하는 역할만 한다.
 */
export async function updateLandingPageImageAction(
  id: string,
  field: LandingPageImageField,
  url: string | null
): Promise<UpdateLandingPageImageResult> {
  if (!id) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  if (!VALID_IMAGE_FIELDS.includes(field)) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await updateLandingPageImageUrl(id, field, url);

  if (result.success) {
    revalidatePath("/admin/pages");
    revalidatePath("/admin");
    revalidatePath(`/admin/pages/${id}/edit`);
    if (result.slug) {
      revalidatePath(`/${result.slug}`);
    }
  }

  return { success: result.success, error: result.error };
}

// ============================================================
// SEO / AEO / GEO 설정 (12.5단계)
// ============================================================

export interface UpdateSeoSettingsResult {
  success: boolean;
  error?: string;
}

function validateSeoSettingsInput(
  input: UpdateSeoSettingsInput
): { error?: string } {
  if (input.seoTitle.trim().length > SEO_TITLE_MAX_LENGTH) {
    return { error: `SEO 제목은 ${SEO_TITLE_MAX_LENGTH}자 이내로 입력해주세요.` };
  }
  if (input.ogTitle.trim().length > SEO_TITLE_MAX_LENGTH) {
    return { error: `OG 제목은 ${SEO_TITLE_MAX_LENGTH}자 이내로 입력해주세요.` };
  }
  if (input.seoDescription.trim().length > SEO_DESCRIPTION_MAX_LENGTH) {
    return {
      error: `SEO 설명은 ${SEO_DESCRIPTION_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }
  if (input.ogDescription.trim().length > SEO_DESCRIPTION_MAX_LENGTH) {
    return {
      error: `OG 설명은 ${SEO_DESCRIPTION_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }
  if (input.businessCategory.trim().length > BUSINESS_CATEGORY_MAX_LENGTH) {
    return {
      error: `업종/카테고리는 ${BUSINESS_CATEGORY_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }
  if (input.serviceArea.trim().length > SERVICE_AREA_MAX_LENGTH) {
    return {
      error: `서비스 지역은 ${SERVICE_AREA_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }
  return {};
}

/**
 * 페이지 1건의 SEO/AEO/GEO 설정을 저장한다. 비어있는 필드는 null로 저장되어
 * resolveLandingPageSeo(lib/seo-resolver.ts)가 자동값을 쓰게 된다.
 */
export async function updateSeoSettingsAction(
  landingPageId: string,
  slug: string,
  input: UpdateSeoSettingsInput
): Promise<UpdateSeoSettingsResult> {
  if (!landingPageId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const { error } = validateSeoSettingsInput(input);
  if (error) {
    return { success: false, error };
  }

  const result = await upsertSeoSettings(landingPageId, input);

  if (result.success) {
    revalidateSeoPaths(landingPageId, slug);
  }

  return result;
}

/**
 * SEO title/description/OG title/description을 자동값으로 되돌린다.
 * 업종/서비스 지역/색인 설정/자동 FAQ 사용 여부는 그대로 유지한다.
 */
export async function resetSeoOverridesAction(
  landingPageId: string,
  slug: string
): Promise<UpdateSeoSettingsResult> {
  if (!landingPageId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await resetSeoOverrides(landingPageId);

  if (result.success) {
    revalidateSeoPaths(landingPageId, slug);
  }

  return result;
}

export interface UpdateSeoOgImageResult {
  success: boolean;
  error?: string;
}

/**
 * 전용 OG 이미지 URL을 갱신한다.
 * 실제 파일 업로드/삭제는 브라우저에서 Supabase Storage로 직접 처리되고,
 * 이 action은 결과 public URL(또는 null)을 DB에 반영하는 역할만 한다.
 */
export async function updateSeoOgImageAction(
  landingPageId: string,
  slug: string,
  url: string | null
): Promise<UpdateSeoOgImageResult> {
  if (!landingPageId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await updateSeoOgImageUrl(landingPageId, url);

  if (result.success) {
    revalidateSeoPaths(landingPageId, slug);
  }

  return { success: result.success, error: result.error };
}

// ============================================================
// FAQ 관리 (12.5단계)
// ============================================================

export interface FaqActionResult {
  success: boolean;
  error?: string;
  id?: string;
}

function validateFaqInput(input: CreateFaqInput): { error?: string } {
  const question = input.question.trim();
  const answer = input.answer.trim();

  if (!question || !answer) {
    return { error: "질문과 답변을 모두 입력해주세요." };
  }
  if (question.length > FAQ_QUESTION_MAX_LENGTH) {
    return { error: `질문은 ${FAQ_QUESTION_MAX_LENGTH}자 이내로 입력해주세요.` };
  }
  if (answer.length > FAQ_ANSWER_MAX_LENGTH) {
    return { error: `답변은 ${FAQ_ANSWER_MAX_LENGTH}자 이내로 입력해주세요.` };
  }
  return {};
}

export async function createFaqAction(
  landingPageId: string,
  slug: string,
  input: CreateFaqInput
): Promise<FaqActionResult> {
  if (!landingPageId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const { error } = validateFaqInput(input);
  if (error) {
    return { success: false, error };
  }

  const result = await createFaq(landingPageId, {
    question: input.question.trim(),
    answer: input.answer.trim(),
  });

  if (result.success) {
    revalidateSeoPaths(landingPageId, slug);
  }

  return result;
}

export async function updateFaqAction(
  id: string,
  landingPageId: string,
  slug: string,
  input: UpdateFaqInput
): Promise<FaqActionResult> {
  if (!id || !landingPageId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const { error } = validateFaqInput(input);
  if (error) {
    return { success: false, error };
  }

  const result = await updateFaq(id, {
    question: input.question.trim(),
    answer: input.answer.trim(),
    isActive: input.isActive,
  });

  if (result.success) {
    revalidateSeoPaths(landingPageId, slug);
  }

  return result;
}

export async function deleteFaqAction(
  id: string,
  landingPageId: string,
  slug: string
): Promise<FaqActionResult> {
  if (!id || !landingPageId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await deleteFaq(id);

  if (result.success) {
    revalidateSeoPaths(landingPageId, slug);
  }

  return result;
}

export async function moveFaqAction(
  id: string,
  landingPageId: string,
  slug: string,
  direction: FaqMoveDirection
): Promise<FaqActionResult> {
  if (!id || !landingPageId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await moveFaq(landingPageId, id, direction);

  if (result.success) {
    revalidateSeoPaths(landingPageId, slug);
  }

  return result;
}
