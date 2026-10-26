import type { LandingPage } from "@/types/landing-page";
import type { ResolvedFaq } from "@/types/seo";
import type { ResolvedLandingPageSeo } from "@/lib/seo-resolver";
import type { SiteProfile } from "@/lib/site-profile";
import { getAbsoluteUrl, getSiteUrl } from "@/lib/site";
import type { BreadcrumbItem } from "@/lib/local-seo";
import { areaName, looksLikePostalAddress } from "@/lib/business-info";
import { getLandingPhotos, isSiteBusinessPage, resolvePageLogoUrl } from "@/lib/landing-photos";

const SCHEMA_CONTEXT = "https://schema.org";

/** 구조화 데이터에 쓰는 대표 업체 정보(관리자 설정, lib/site-profile.ts) */
export type SiteBusiness = Pick<SiteProfile, "businessName" | "description" | "phone" | "kakaoUrl"> &
  Partial<Pick<SiteProfile, "logoUrl">>;

/** 홈·랜딩페이지가 같은 업체를 가리키도록 쓰는 고정 @id */
export function siteBusinessId(): string {
  return getAbsoluteUrl("/#business");
}

export function siteWebsiteId(): string {
  return getAbsoluteUrl("/#website");
}

/** 랜딩페이지 업체명이 대표 업체명과 같으면(공백 차이 무시) 같은 업체로 묶는다 */
function isSiteBusiness(landingPage: LandingPage, site: SiteBusiness | null): site is SiteBusiness & { businessName: string } {
  return isSiteBusinessPage(landingPage, site);
}

/**
 * public 랜딩페이지 1건에 대한 WebPage JSON-LD를 만든다.
 * DB에 없는 값(이미지 등)은 필드 자체를 생략한다 — 빈 문자열/undefined를
 * 그대로 넣지 않는다.
 */
export function buildWebPageJsonLd(
  landingPage: LandingPage,
  resolvedSeo: ResolvedLandingPageSeo,
  site: SiteBusiness | null = null
) {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebPage",
    "@id": resolvedSeo.canonical,
    url: resolvedSeo.canonical,
    name: resolvedSeo.title,
    description: resolvedSeo.description,
    inLanguage: "ko-KR",
    isPartOf: { "@id": siteWebsiteId() },
    dateModified: landingPage.updated_at,
    ...(resolvedSeo.ogImage
      ? {
          primaryImageOfPage: {
            "@type": "ImageObject",
            url: resolvedSeo.ogImage,
          },
        }
      : {}),
    about: isSiteBusiness(landingPage, site)
      ? { "@id": siteBusinessId() }
      : { "@type": "Thing", name: landingPage.business_name },
  };
}

/**
 * 실제 사용 가능한 데이터만으로 LocalBusiness 또는 Organization JSON-LD를 만든다.
 * - 주소 칸이 실제 주소로 보이거나(lib/business-info.ts) 서비스 지역이 있으면 LocalBusiness,
 *   둘 다 없으면 일반 Organization. 제목형 문구·slug가 든 주소 칸은 PostalAddress로 내보내지 않는다.
 * - 업체명이 사이트 대표 업체(관리자 설정)와 같으면 홈과 같은 @id·이름·주소(홈)·소개를 써서
 *   모든 페이지가 같은 업체 하나를 가리키게 한다. 전화는 페이지 값 → 대표 업체 값 순서.
 * business_category는 임의의 schema.org 하위 타입으로 변환하지 않고
 * knowsAbout(업종 정보)로만 안전하게 표현한다.
 */
export function buildOrganizationJsonLd(
  landingPage: LandingPage,
  resolvedSeo: ResolvedLandingPageSeo,
  site: SiteBusiness | null = null
) {
  const sameAsSite = isSiteBusiness(landingPage, site);
  const address = looksLikePostalAddress(landingPage.address, [landingPage.business_name, landingPage.title])
    ? landingPage.address?.trim()
    : null;
  const areaServed = areaServedOf(landingPage, resolvedSeo);
  const telephone = landingPage.phone?.trim() || (sameAsSite ? site.phone : null);
  const type = sameAsSite || address || areaServed.areaServed ? "LocalBusiness" : "Organization";
  const photos = getLandingPhotos(landingPage);
  const logo = resolvePageLogoUrl(landingPage, site);

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": type,
    ...(sameAsSite ? { "@id": siteBusinessId() } : {}),
    name: sameAsSite ? site.businessName : landingPage.business_name,
    url: sameAsSite ? getAbsoluteUrl("/") : resolvedSeo.canonical,
    description: (sameAsSite ? site.description : null) ?? resolvedSeo.description,
    ...(telephone ? { telephone } : {}),
    ...(address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: address,
            addressCountry: "KR",
          },
        }
      : {}),
    // 019: 페이지 사진 1~3(화면에 보이는 사진과 같은 순서). 로고는 페이지 로고 → 같은 업체면 대표 업체 로고
    ...(photos.length > 0 ? { image: photos.map((photo) => photo.url) } : {}),
    ...(logo ? { logo } : {}),
    ...areaServed,
    ...(resolvedSeo.businessCategory
      ? { knowsAbout: [resolvedSeo.businessCategory] }
      : {}),
  };
}

/**
 * 서비스 지역(areaServed). 관리자가 SEO 설정에 "서비스 지역"을 직접 넣었으면 그 글자를,
 * 아니면 대기열에서 공개된 페이지의 시/군·지역으로 AdministrativeArea를 만든다(7단계).
 * 지역 칸에 시/군이 이미 들어 있으면 두 번 쓰지 않는다("군포시 군포시 산본동" 방지).
 * 둘 다 없으면 생략한다(추측해서 채우지 않음).
 */
function areaServedOf(landingPage: LandingPage, resolvedSeo: ResolvedLandingPageSeo) {
  if (resolvedSeo.serviceArea) return { areaServed: resolvedSeo.serviceArea };
  const name = areaName(landingPage.city, landingPage.region);
  return name ? { areaServed: { "@type": "AdministrativeArea", name } } : {};
}

/**
 * 공개 홈(/)의 업체 JSON-LD. 대표 업체명이 없으면 만들지 않는다(null).
 * 서비스 지역은 지역 모음 페이지가 있는 시/군 목록(실제로 공개된 페이지 기준).
 * 주소 칸은 대표 업체 설정에 없으므로 넣지 않는다.
 */
export function buildSiteBusinessJsonLd(site: SiteBusiness, cities: readonly string[]) {
  if (!site.businessName) return null;
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "LocalBusiness",
    "@id": siteBusinessId(),
    name: site.businessName,
    url: getAbsoluteUrl("/"),
    ...(site.description ? { description: site.description } : {}),
    ...(site.phone ? { telephone: site.phone } : {}),
    ...(site.logoUrl ? { logo: site.logoUrl } : {}),
    ...(cities.length > 0
      ? { areaServed: cities.map((name) => ({ "@type": "AdministrativeArea", name })) }
      : {}),
  };
}

/** 공개 홈(/)의 WebSite JSON-LD. 이름은 대표 업체명, 없으면 도메인 */
export function buildWebSiteJsonLd(site: SiteBusiness | null, description: string) {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    "@id": siteWebsiteId(),
    url: getAbsoluteUrl("/"),
    name: site?.businessName ?? new URL(getSiteUrl()).host,
    description,
    inLanguage: "ko-KR",
    ...(site?.businessName ? { publisher: { "@id": siteBusinessId() } } : {}),
  };
}

/** 화면에 보이는 경로(홈 > 시/군 > 페이지)와 같은 BreadcrumbList */
export function buildBreadcrumbJsonLd(items: readonly BreadcrumbItem[]) {
  if (items.length < 2) return null;
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: getAbsoluteUrl(item.path),
    })),
  };
}

/**
 * 화면에 실제로 렌더링되는 FAQ가 있을 때만 FAQPage JSON-LD를 만든다.
 * 여기 들어가는 질문/답변은 반드시 화면에 보이는 것과 동일해야 하므로,
 * FAQSection과 항상 같은 resolvedFaqs 배열을 전달받아야 한다.
 */
export function buildFaqPageJsonLd(faqs: ResolvedFaq[]) {
  if (faqs.length === 0) return null;

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}
