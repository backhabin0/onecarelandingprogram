import type { LandingPage } from "@/types/landing-page";
import { isSameText } from "@/lib/business-info";
import { buildImageAlt } from "@/lib/local-seo";
import { libraryOgUrlOf } from "@/lib/media/library";

/**
 * 019: 랜딩페이지 사진 3장·로고를 화면·og:image·구조화 데이터가 같은 규칙으로 쓰도록 모은 순수 함수.
 * 사진 1 = main_image_url(첫 화면 대표 사진), 사진 2·3 = 본문 사진 갤러리.
 */

/** 대표 업체 정보 중 사진 규칙에 필요한 값(lib/site-profile.ts SiteProfile의 일부) */
export interface SitePhotoInfo {
  businessName: string | null;
  logoUrl?: string | null;
}

type PhotoPage = Pick<
  LandingPage,
  | "business_name"
  | "region"
  | "keyword"
  | "main_image_url"
  | "main_image_alt"
  | "image_2_url"
  | "image_2_alt"
  | "image_3_url"
  | "image_3_alt"
>;

export interface LandingPhoto {
  url: string;
  alt: string;
  /** 1 = 대표 사진, 2·3 = 갤러리 */
  position: 1 | 2 | 3;
}

const clean = (value: string | null | undefined) => value?.trim() || "";

/** 업체명이 대표 업체명과 같으면(공백 차이 무시) 같은 업체 — 구조화 데이터 묶기·대표 로고에 같은 규칙 */
export function isSiteBusinessPage(
  page: Pick<LandingPage, "business_name">,
  site: SitePhotoInfo | null | undefined
): boolean {
  return Boolean(site?.businessName) && isSameText(site?.businessName, page.business_name);
}

/**
 * 페이지 사진(있는 것만, 순서대로). 설명이 비어 있으면 사진1은 "지역 키워드 현장",
 * 사진2·3은 같은 문구 뒤에 번호를 붙인다(같은 alt가 겹치지 않게).
 */
export function getLandingPhotos(page: PhotoPage): LandingPhoto[] {
  const autoAlt = buildImageAlt({ ...page, main_image_alt: null });
  const slots: [string | null, string | null, 1 | 2 | 3][] = [
    [page.main_image_url, page.main_image_alt, 1],
    [page.image_2_url ?? null, page.image_2_alt ?? null, 2],
    [page.image_3_url ?? null, page.image_3_alt ?? null, 3],
  ];
  const photos: LandingPhoto[] = [];
  for (const [url, alt, position] of slots) {
    const src = clean(url);
    if (!src) continue;
    photos.push({ url: src, alt: clean(alt) || (position === 1 ? autoAlt : `${autoAlt} ${position}`), position });
  }
  return photos;
}

/** 본문 갤러리에 보일 사진(사진 2·3). 사진1은 첫 화면에 이미 나온다 */
export function getGalleryPhotos(page: PhotoPage): LandingPhoto[] {
  return getLandingPhotos(page).filter((photo) => photo.position !== 1);
}

/**
 * 화면·구조화 데이터에 쓸 로고: 페이지 로고 → (페이지 로고가 비어 있고 업체명이 대표 업체와 같을 때만)
 * 대표 업체 로고. 다른 업체 페이지에 대표 업체 로고가 붙지 않게 한다.
 */
export function resolvePageLogoUrl(
  page: Pick<LandingPage, "business_name" | "logo_url">,
  site: SitePhotoInfo | null | undefined
): string | null {
  const own = clean(page.logo_url);
  if (own) return own;
  if (isSiteBusinessPage(page, site)) return clean(site?.logoUrl) || null;
  return null;
}

export interface ResolvedOgImage {
  url: string;
  /** 보관함에서 만든 1200×630 JPEG면 크기를 알 수 있다 */
  width?: number;
  height?: number;
}

/**
 * og:image 자동값: 사진1의 공유용 사진(보관함 1200×630 JPEG) → 사진1 → 로고(대표 업체 로고 포함).
 * SEO 설정의 전용 OG 이미지는 호출하는 쪽(lib/seo-resolver.ts)이 먼저 쓴다.
 */
export function resolveAutoOgImage(
  page: Pick<LandingPage, "business_name" | "logo_url" | "main_image_url">,
  site: SitePhotoInfo | null | undefined
): ResolvedOgImage | null {
  const main = clean(page.main_image_url);
  const og = libraryOgUrlOf(main);
  if (og) return { url: og, width: 1200, height: 630 };
  if (main) return { url: main };
  const logo = resolvePageLogoUrl(page, site);
  return logo ? { url: logo } : null;
}
