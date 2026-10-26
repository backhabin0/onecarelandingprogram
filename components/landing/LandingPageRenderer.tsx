import type { LandingPage } from "@/types/landing-page";
import type { ResolvedFaq } from "@/types/seo";
import type { ResolvedLandingPageSeo } from "@/lib/seo-resolver";
import {
  buildBreadcrumbJsonLd,
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildWebPageJsonLd,
  type SiteBusiness,
} from "@/lib/structured-data";
import {
  buildHeadline,
  buildImageAlt,
  buildPageBreadcrumbs,
  type RelatedLinks,
} from "@/lib/local-seo";
import { getGalleryPhotos, resolvePageLogoUrl } from "@/lib/landing-photos";
import TemplateA from "@/components/landing/templates/TemplateA";
import TemplateB from "@/components/landing/templates/TemplateB";
import { resolveTemplateId } from "@/components/landing/templates";
import PageViewTracker from "@/components/analytics/PageViewTracker";
import JsonLd from "@/components/seo/JsonLd";

interface LandingPageRendererProps {
  landingPage: LandingPage;
  faqs: ResolvedFaq[];
  /** public 렌더링에서만 필요하다(JSON-LD 계산용). preview 모드에서는 JSON-LD를 출력하지 않으므로 생략할 수 있다. */
  resolvedSeo?: ResolvedLandingPageSeo;
  /** 하단 내부 링크(7단계). 공개 페이지에서만 넘긴다 — 미리보기에서는 생략 */
  related?: RelatedLinks | null;
  /** 사이트 대표 업체(관리자 설정). 업체명이 같으면 구조화 데이터를 홈과 같은 업체로 묶는다 */
  siteBusiness?: SiteBusiness | null;
  /**
   * "public"(기본값): 실제 고객용 페이지. JSON-LD, page_view/전화/카카오 Analytics,
   * 실제 상담 제출이 모두 동작한다.
   * "preview": 관리자 전용 미리보기(16단계). 시각적 레이아웃/CTA/FAQ는 동일하지만
   * JSON-LD를 출력하지 않고, Analytics를 기록하지 않고, 상담 제출을 막는다.
   */
  mode?: "public" | "preview";
}

export default function LandingPageRenderer({
  landingPage,
  faqs,
  resolvedSeo,
  related = null,
  siteBusiness = null,
  mode = "public",
}: LandingPageRendererProps) {
  const preview = mode === "preview";

  // H1·경로·사진 alt는 지역·키워드(대기열에서 공개된 페이지)를 반영한다. 두 템플릿이 같은 값을 쓴다.
  const headline = buildHeadline(landingPage.title, landingPage.region, landingPage.keyword);
  const imageAlt = buildImageAlt(landingPage);
  const breadcrumbs = buildPageBreadcrumbs(landingPage, headline);

  const webPageJsonLd = resolvedSeo
    ? buildWebPageJsonLd(landingPage, resolvedSeo, siteBusiness)
    : null;
  const organizationJsonLd = resolvedSeo
    ? buildOrganizationJsonLd(landingPage, resolvedSeo, siteBusiness)
    : null;
  const faqPageJsonLd = buildFaqPageJsonLd(faqs);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbs);

  const templateProps = {
    landingPage,
    faqs,
    headline,
    imageAlt,
    breadcrumbs,
    related: preview ? null : related,
    preview,
    logoUrl: resolvePageLogoUrl(landingPage, siteBusiness),
    gallery: getGalleryPhotos(landingPage),
  };

  return (
    <>
      {!preview && webPageJsonLd ? <JsonLd data={webPageJsonLd} /> : null}
      {!preview && organizationJsonLd ? (
        <JsonLd data={organizationJsonLd} />
      ) : null}
      {!preview && faqPageJsonLd ? <JsonLd data={faqPageJsonLd} /> : null}
      {!preview && breadcrumbJsonLd ? <JsonLd data={breadcrumbJsonLd} /> : null}
      {!preview ? <PageViewTracker slug={landingPage.slug} /> : null}
      {resolveTemplateId(landingPage.template) === "template-b" ? (
        <TemplateB {...templateProps} />
      ) : (
        <TemplateA {...templateProps} />
      )}
    </>
  );
}
