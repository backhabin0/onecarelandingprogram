import type { Metadata } from "next";
import type { LandingPage } from "@/types/landing-page";
import { getAbsoluteUrl } from "@/lib/site";

const DESCRIPTION_MAX_LENGTH = 160;
const DEFAULT_TITLE = "OneCare";
const DEFAULT_DESCRIPTION = "믿을 수 있는 전문가와 지금 바로 상담해보세요.";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/** `제목 | 업체명` 형태의 SEO title. 값이 비어 있으면 안전한 fallback을 사용한다. */
export function buildSeoTitle(landingPage: LandingPage): string {
  const title = landingPage.title.trim();
  const businessName = landingPage.business_name.trim();

  if (title && businessName) return `${title} | ${businessName}`;
  if (title) return title;
  if (businessName) return businessName;
  return DEFAULT_TITLE;
}

/**
 * description 우선순위: description → hero_text → 업체명/제목 기반 기본 설명.
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

/** main_image_url → logo_url 순으로 OG/Twitter 이미지를 고른다. 둘 다 없으면 undefined. */
function pickOgImage(landingPage: LandingPage): string | undefined {
  return landingPage.main_image_url || landingPage.logo_url || undefined;
}

/**
 * public 랜딩페이지 1건에 대한 Metadata를 만든다.
 * app/[slug]/page.tsx의 generateMetadata에서 사용한다.
 */
export function buildLandingPageMetadata(landingPage: LandingPage): Metadata {
  const title = buildSeoTitle(landingPage);
  const description = buildSeoDescription(landingPage);
  const url = getAbsoluteUrl(`/${landingPage.slug}`);
  const ogImage = pickOgImage(landingPage);

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}
