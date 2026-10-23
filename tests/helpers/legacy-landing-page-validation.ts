/**
 * 2단계 리팩터링 전 app/admin/pages/actions.ts에 있던 검증 함수의 원본 복사본.
 * (normalizeAndValidate / validateSeoSettingsInput / validateFaqInput)
 *
 * 회귀 테스트에서 "예전 규칙"의 기준(oracle)으로만 쓴다. 새 규칙을 만들 때
 * 이 파일을 고치지 말 것 — 의도적으로 규칙을 바꾼 경우에만, 바뀐 내용을
 * 테스트 쪽 기대값에 반영한다.
 */
import { isReservedSlug } from "@/lib/slug";
import type {
  CreateLandingPageInput,
  LandingPageStatus,
  UpdateLandingPageInput,
} from "@/types/landing-page";
import type {
  CreateFaqInput,
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

const BUSINESS_NAME_MAX_LENGTH = 100;
const TITLE_MAX_LENGTH = 100;
const HERO_TEXT_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;
const PHONE_MAX_LENGTH = 30;
const ADDRESS_MAX_LENGTH = 200;
const KAKAO_URL_MAX_LENGTH = 500;

/**
 * http/https만 허용한다(javascript:/data:/file: 등 위험한 스킴 차단).
 * open.kakao.com 등 특정 호스트를 강제하지 않는 이유는 카카오 채널/오픈채팅
 * URL 형태가 바뀔 수 있어, 정상적인 서비스 URL 변화에 대응하기 위해서다.
 */
function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}


export interface LegacyNormalizedInput {
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

export function legacyNormalizeAndValidate(
  input: CreateLandingPageInput | UpdateLandingPageInput
): { normalized: LegacyNormalizedInput; error?: string } {
  const businessName = input.businessName.trim();
  const title = input.title.trim();
  const slug = input.slug.trim().toLowerCase();
  const template = input.template.trim();
  const heroText = input.heroText.trim();
  const description = input.description.trim();
  const phone = input.phone.trim();
  const kakaoUrl = input.kakaoUrl.trim();
  const address = input.address.trim();

  const normalized: LegacyNormalizedInput = {
    businessName,
    title,
    slug,
    template,
    heroText,
    description,
    phone,
    kakaoUrl,
    address,
  };

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

  if (isReservedSlug(slug)) {
    return { normalized, error: "사용할 수 없는 URL입니다." };
  }

  if (businessName.length > BUSINESS_NAME_MAX_LENGTH) {
    return {
      normalized,
      error: `업체명은 ${BUSINESS_NAME_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }

  if (title.length > TITLE_MAX_LENGTH) {
    return {
      normalized,
      error: `페이지 제목은 ${TITLE_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }

  if (heroText.length > HERO_TEXT_MAX_LENGTH) {
    return {
      normalized,
      error: `대표 문구는 ${HERO_TEXT_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }

  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return {
      normalized,
      error: `소개 문구는 ${DESCRIPTION_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }

  if (phone.length > PHONE_MAX_LENGTH) {
    return {
      normalized,
      error: `전화번호는 ${PHONE_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }

  if (address.length > ADDRESS_MAX_LENGTH) {
    return {
      normalized,
      error: `주소는 ${ADDRESS_MAX_LENGTH}자 이내로 입력해주세요.`,
    };
  }

  if (kakaoUrl) {
    if (kakaoUrl.length > KAKAO_URL_MAX_LENGTH) {
      return {
        normalized,
        error: `카카오톡 URL은 ${KAKAO_URL_MAX_LENGTH}자 이내로 입력해주세요.`,
      };
    }
    if (!isSafeExternalUrl(kakaoUrl)) {
      return {
        normalized,
        error:
          "카카오톡 URL은 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다.",
      };
    }
  }

  return { normalized };
}
export function legacyValidateSeoSettingsInput(
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
export function legacyValidateFaqInput(input: CreateFaqInput): { error?: string } {
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
