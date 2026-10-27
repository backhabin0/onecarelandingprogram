import type { LandingPage } from "@/types/landing-page";
import type { LandingPageSeoSettings } from "@/types/seo";
import { buildSeoTitle, buildSeoDescription } from "@/lib/seo-auto";
import { getAbsoluteUrl } from "@/lib/site";
import { resolveAutoOgImage, type SitePhotoInfo } from "@/lib/landing-photos";

/**
 * public 랜딩페이지 1건에 대해 실제로 적용될 SEO/AEO/GEO 값을 계산한 결과.
 * generateMetadata와 구조화 데이터(JSON-LD)가 서로 다른 값을 쓰는 일이 없도록
 * 이 하나의 resolver 결과를 양쪽에서 그대로 재사용한다.
 */
export interface ResolvedLandingPageSeo {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage?: string;
  /** 019: og:image가 보관함에서 만든 1200×630 JPEG면 그 크기 */
  ogImageSize?: { width: number; height: number };
  robots: { index: boolean; follow: boolean };
  businessCategory?: string;
  serviceArea?: string;
}

/** 관리자 미리보기용: 각 필드가 자동값인지 직접 설정값인지 구분한다. */
export type SeoFieldSource = "auto" | "manual";

function manualOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveLandingPageSeo(
  landingPage: LandingPage,
  seoSettings: LandingPageSeoSettings | null,
  /** 019: 대표 업체(로고 대체용). 없으면 페이지 로고만 본다 */
  site: SitePhotoInfo | null = null
): ResolvedLandingPageSeo {
  const autoTitle = buildSeoTitle(landingPage);
  const autoDescription = buildSeoDescription(landingPage);

  const manualTitle = manualOrUndefined(seoSettings?.seo_title);
  const manualDescription = manualOrUndefined(seoSettings?.seo_description);
  const manualOgTitle = manualOrUndefined(seoSettings?.og_title);
  const manualOgDescription = manualOrUndefined(seoSettings?.og_description);
  const manualOgImage = manualOrUndefined(seoSettings?.og_image_url);

  const title = manualTitle ?? autoTitle;
  const description = manualDescription ?? autoDescription;
  const ogTitle = manualOgTitle ?? manualTitle ?? autoTitle;
  const ogDescription = manualOgDescription ?? manualDescription ?? autoDescription;
  // 전용 OG 이미지 → 사진1의 공유용 사진(1200×630) → 사진1 → 로고(대표 업체 로고 포함)
  const autoOgImage = manualOgImage ? null : resolveAutoOgImage(landingPage, site);
  const ogImage = manualOgImage ?? autoOgImage?.url ?? undefined;
  const ogImageSize =
    autoOgImage?.width && autoOgImage.height ? { width: autoOgImage.width, height: autoOgImage.height } : undefined;

  const noindex = seoSettings?.seo_noindex ?? false;

  return {
    title,
    description,
    canonical: getAbsoluteUrl(`/${landingPage.slug}`),
    ogTitle,
    ogDescription,
    ogImage,
    ...(ogImageSize ? { ogImageSize } : {}),
    robots: { index: !noindex, follow: true },
    businessCategory: manualOrUndefined(seoSettings?.business_category),
    serviceArea: manualOrUndefined(seoSettings?.service_area),
  };
}

/** 관리자 화면에서 "자동" / "직접 설정" Badge를 표시하기 위한 판별 함수. */
export function getSeoFieldSource(
  value: string | null | undefined
): SeoFieldSource {
  return manualOrUndefined(value) ? "manual" : "auto";
}
