"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  isValidLandingPageStatus,
  validateDuplicateLandingPageInput,
  validateFaqInput,
  validateLandingPageInput,
  validateSeoSettingsInput,
} from "@/lib/landing-page-validation";
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

/** SEO/FAQ 관련 화면에 영향을 주는 경로를 한 번에 갱신한다. */
function revalidateSeoPaths(landingPageId: string, slug: string) {
  revalidatePath(`/admin/pages/${landingPageId}/edit`);
  revalidatePath(`/${slug}`);
}

export interface CreateLandingPageResult {
  success: boolean;
  error?: string;
  id?: string;
}

export async function createLandingPageAction(
  input: CreateLandingPageInput
): Promise<CreateLandingPageResult> {
  await requireUser();

  const { normalized, error } = validateLandingPageInput(input);

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
  await requireUser();

  if (!id) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const { normalized, error } = validateLandingPageInput(input);

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
  await requireUser();

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
 * 규칙(lib/landing-page-validation.ts — slug 패턴, 필수값, status, 글자 수)을 쓴다.
 * 실제 복제(기본 데이터/SEO/FAQ 복사, consultation/Analytics 제외, rollback)는
 * lib/landing-pages.ts의 duplicateLandingPage가 담당한다.
 */
export async function duplicateLandingPageAction(
  sourceId: string,
  input: DuplicateLandingPageInput
): Promise<DuplicateLandingPageActionResult> {
  await requireUser();

  if (!sourceId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const { normalized, error } = validateDuplicateLandingPageInput(input);

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
  await requireUser();

  if (!id) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  if (!isValidLandingPageStatus(status)) {
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
  await requireUser();

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

/**
 * 페이지 1건의 SEO/AEO/GEO 설정을 저장한다. 비어있는 필드는 null로 저장되어
 * resolveLandingPageSeo(lib/seo-resolver.ts)가 자동값을 쓰게 된다.
 */
export async function updateSeoSettingsAction(
  landingPageId: string,
  slug: string,
  input: UpdateSeoSettingsInput
): Promise<UpdateSeoSettingsResult> {
  await requireUser();

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
  await requireUser();

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
  await requireUser();

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

export async function createFaqAction(
  landingPageId: string,
  slug: string,
  input: CreateFaqInput
): Promise<FaqActionResult> {
  await requireUser();

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
  await requireUser();

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
  await requireUser();

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
  await requireUser();

  if (!id || !landingPageId) {
    return { success: false, error: "잘못된 요청입니다." };
  }

  const result = await moveFaq(landingPageId, id, direction);

  if (result.success) {
    revalidateSeoPaths(landingPageId, slug);
  }

  return result;
}
