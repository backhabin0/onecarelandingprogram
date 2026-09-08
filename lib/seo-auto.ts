import type { LandingPage } from "@/types/landing-page";

const DESCRIPTION_MAX_LENGTH = 160;
const DEFAULT_TITLE = "OneCare";
const DEFAULT_DESCRIPTION = "믿을 수 있는 전문가와 지금 바로 상담해보세요.";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/** `제목 | 업체명` 형태의 자동 SEO title. 값이 비어 있으면 안전한 fallback을 사용한다. */
export function buildSeoTitle(landingPage: LandingPage): string {
  const title = landingPage.title.trim();
  const businessName = landingPage.business_name.trim();

  if (title && businessName) return `${title} | ${businessName}`;
  if (title) return title;
  if (businessName) return businessName;
  return DEFAULT_TITLE;
}

/**
 * 자동 description 우선순위: description → hero_text → 업체명/제목 기반 기본 설명.
 * plain text만 사용하고, 검색결과 노출 길이를 고려해 적절히 자른다.
 */
export function buildSeoDescription(landingPage: LandingPage): string {
  const description = landingPage.description?.trim();
  if (description) return truncate(description, DESCRIPTION_MAX_LENGTH);

  const heroText = landingPage.hero_text?.trim();
  if (heroText) return truncate(heroText, DESCRIPTION_MAX_LENGTH);

  const businessName = landingPage.business_name.trim();
  const title = landingPage.title.trim();
  if (businessName && title) {
    return truncate(`${businessName}의 ${title} 안내입니다.`, DESCRIPTION_MAX_LENGTH);
  }

  return DEFAULT_DESCRIPTION;
}
