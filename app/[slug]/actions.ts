"use server";

import { getPublicLandingPageIdBySlug } from "@/lib/landing-pages";
import { insertConsultationRequest } from "@/lib/consultation-requests";
import { sendConsultationNotification } from "@/lib/notifications/consultation-email";
import type { CreateConsultationRequestInput } from "@/types/consultation-request";

const NAME_MAX_LENGTH = 50;
const MESSAGE_MAX_LENGTH = 1000;
const PHONE_ALLOWED_PATTERN = /^[0-9+\-\s()]+$/;
const PHONE_DIGITS_MIN = 9;
const PHONE_DIGITS_MAX = 11;
const SUBMISSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GENERIC_ERROR =
  "상담 신청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";

export interface CreateConsultationRequestResult {
  success: boolean;
  error?: string;
}

function validateInput(
  input: CreateConsultationRequestInput
): { error?: string } {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const message = input.message.trim();

  if (!name) {
    return { error: "이름을 입력해주세요." };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return { error: "이름이 너무 깁니다." };
  }

  if (!phone) {
    return { error: "연락처를 입력해주세요." };
  }
  const digitsOnly = phone.replace(/\D/g, "");
  if (
    !PHONE_ALLOWED_PATTERN.test(phone) ||
    digitsOnly.length < PHONE_DIGITS_MIN ||
    digitsOnly.length > PHONE_DIGITS_MAX
  ) {
    return { error: "올바른 연락처를 입력해주세요." };
  }

  if (message.length > MESSAGE_MAX_LENGTH) {
    return { error: "문의내용이 너무 깁니다." };
  }

  if (input.privacyConsent !== true) {
    return { error: "개인정보 수집 및 이용에 동의해주세요." };
  }

  if (!input.slug.trim()) {
    return { error: GENERIC_ERROR };
  }

  if (!SUBMISSION_ID_PATTERN.test(input.submissionId)) {
    return { error: GENERIC_ERROR };
  }

  return {};
}

/**
 * 공개 랜딩페이지의 상담 신청폼에서 호출되는 Server Action.
 *
 * 클라이언트가 넘긴 slug만 신뢰의 출발점으로 삼고, 실제 landing_page id와
 * public 여부는 이 함수 안에서 다시 DB로 확인한다 — 클라이언트가 임의의
 * landing_page_id를 보내더라도 그 값을 그대로 저장하지 않는다.
 */
export async function createConsultationRequestAction(
  input: CreateConsultationRequestInput
): Promise<CreateConsultationRequestResult> {
  // Honeypot: 숨겨진 필드가 채워져 있으면 자동 제출로 간주하고 저장하지 않는다.
  // 정상 사용자에게는 성공한 것처럼 보이게만 하고 실제 처리는 하지 않는다.
  if (input.website.trim()) {
    return { success: true };
  }

  const { error: validationError } = validateInput(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const slug = input.slug.trim();
  const { data: landingPage } = await getPublicLandingPageIdBySlug(slug);

  if (!landingPage) {
    return { success: false, error: GENERIC_ERROR };
  }

  const name = input.name.trim();
  const phone = input.phone.trim();
  const message = input.message.trim() || null;

  const result = await insertConsultationRequest({
    landingPageId: landingPage.id,
    name,
    phone,
    message,
    submissionId: input.submissionId,
  });

  if (!result.success) {
    return { success: false, error: result.error ?? GENERIC_ERROR };
  }

  // duplicate === true면 네트워크 재시도/중복 클릭으로 이미 처리된 동일
  // submission_id가 다시 도착한 것이다 — 새 row도, 새 이메일도 만들지 않고
  // 첫 제출과 동일한 성공 응답만 돌려준다(17단계 idempotency).
  if (result.duplicate) {
    return { success: true };
  }

  // 이메일 알림은 부가 기능이다 — 실패해도 이미 저장된 상담 신청 자체는
  // 성공으로 처리한다(핵심 원칙: 상담 데이터 보존이 이메일보다 우선).
  try {
    await sendConsultationNotification({
      businessName: landingPage.business_name,
      slug,
      name,
      phone,
      message,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error("[consultation-email] notification error:", err);
  }

  return { success: true };
}
