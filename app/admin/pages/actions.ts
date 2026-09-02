"use server";

import { revalidatePath } from "next/cache";
import {
  deleteLandingPage,
  insertLandingPage,
  updateLandingPage,
  updateLandingPageStatus,
} from "@/lib/landing-pages";
import type {
  CreateLandingPageInput,
  LandingPageStatus,
  UpdateLandingPageInput,
} from "@/types/landing-page";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_STATUSES: LandingPageStatus[] = ["public", "private"];

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
