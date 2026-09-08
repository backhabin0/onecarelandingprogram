import type { LandingPage } from "@/types/landing-page";
import type { ResolvedFaq } from "@/types/seo";
import type { ResolvedLandingPageSeo } from "@/lib/seo-resolver";

const SCHEMA_CONTEXT = "https://schema.org";

/**
 * public 랜딩페이지 1건에 대한 WebPage JSON-LD를 만든다.
 * DB에 없는 값(이미지 등)은 필드 자체를 생략한다 — 빈 문자열/undefined를
 * 그대로 넣지 않는다.
 */
export function buildWebPageJsonLd(
  landingPage: LandingPage,
  resolvedSeo: ResolvedLandingPageSeo
) {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebPage",
    "@id": resolvedSeo.canonical,
    url: resolvedSeo.canonical,
    name: resolvedSeo.title,
    description: resolvedSeo.description,
    dateModified: landingPage.updated_at,
    ...(resolvedSeo.ogImage
      ? {
          primaryImageOfPage: {
            "@type": "ImageObject",
            url: resolvedSeo.ogImage,
          },
        }
      : {}),
    about: {
      "@type": "Thing",
      name: landingPage.business_name,
    },
  };
}

/**
 * 실제 사용 가능한 데이터만으로 Organization 또는 LocalBusiness JSON-LD를
 * 만든다. 주소가 있으면 LocalBusiness, 없으면 일반 Organization을 사용한다.
 * business_category는 임의의 schema.org 하위 타입으로 변환하지 않고
 * knowsAbout(업종 정보)로만 안전하게 표현한다.
 */
export function buildOrganizationJsonLd(
  landingPage: LandingPage,
  resolvedSeo: ResolvedLandingPageSeo
) {
  const type = landingPage.address?.trim() ? "LocalBusiness" : "Organization";

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": type,
    name: landingPage.business_name,
    url: resolvedSeo.canonical,
    description: resolvedSeo.description,
    ...(landingPage.phone?.trim() ? { telephone: landingPage.phone.trim() } : {}),
    ...(landingPage.address?.trim()
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: landingPage.address.trim(),
          },
        }
      : {}),
    ...(landingPage.main_image_url ? { image: landingPage.main_image_url } : {}),
    ...(landingPage.logo_url ? { logo: landingPage.logo_url } : {}),
    ...(resolvedSeo.serviceArea ? { areaServed: resolvedSeo.serviceArea } : {}),
    ...(resolvedSeo.businessCategory
      ? { knowsAbout: [resolvedSeo.businessCategory] }
      : {}),
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
