import type { LandingPage } from "@/types/landing-page";
import { buildHeadline } from "@/lib/local-seo";
import { isSameText, toPlainSummary } from "@/lib/business-info";

const DESCRIPTION_MAX_LENGTH = 160;
const DEFAULT_TITLE = "OneCare";
const DEFAULT_DESCRIPTION = "믿을 수 있는 전문가와 지금 바로 상담해보세요.";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/**
 * `제목 | 업체명` 형태의 자동 SEO title. 값이 비어 있으면 안전한 fallback을 사용한다.
 * 7단계: 지역·키워드가 있는 페이지(대기열에서 공개)는 제목 앞쪽에 "지역 키워드"가 오도록
 * H1과 같은 머리말(buildHeadline)을 쓴다.
 * 업체명 칸에 제목과 같은 글이 들어 있으면(기존 페이지) "X | X"가 되지 않게 업체명을 붙이지 않는다.
 */
export function buildSeoTitle(landingPage: LandingPage): string {
  const title = buildHeadline(landingPage.title, landingPage.region ?? null, landingPage.keyword ?? null);
  const businessName = landingPage.business_name.trim();

  if (title && businessName && !isSameText(title, businessName) && !isSameText(landingPage.title, businessName)) {
    return `${title} | ${businessName}`;
  }
  if (title) return title;
  if (businessName) return businessName;
  return DEFAULT_TITLE;
}

/**
 * 자동 description 우선순위: description → hero_text → 업체명/제목 기반 기본 설명.
 * plain text만 사용하고(해시태그·줄바꿈은 빼고 한 줄로),검색결과 노출 길이를 고려해 적절히 자른다.
 */
export function buildSeoDescription(landingPage: LandingPage): string {
  const description = toPlainSummary(landingPage.description);
  if (description) return truncate(description, DESCRIPTION_MAX_LENGTH);

  const heroText = toPlainSummary(landingPage.hero_text);
  if (heroText) return truncate(heroText, DESCRIPTION_MAX_LENGTH);

  const businessName = landingPage.business_name.trim();
  const title = landingPage.title.trim();
  if (businessName && title) {
    return truncate(`${businessName}의 ${title} 안내입니다.`, DESCRIPTION_MAX_LENGTH);
  }

  return DEFAULT_DESCRIPTION;
}
