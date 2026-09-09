import type { LandingPage } from "@/types/landing-page";
import type { ResolvedFaq } from "@/types/seo";
import type { ResolvedLandingPageSeo } from "@/lib/seo-resolver";
import {
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildWebPageJsonLd,
} from "@/lib/structured-data";
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
  mode = "public",
}: LandingPageRendererProps) {
  const preview = mode === "preview";

  const webPageJsonLd = resolvedSeo
    ? buildWebPageJsonLd(landingPage, resolvedSeo)
    : null;
  const organizationJsonLd = resolvedSeo
    ? buildOrganizationJsonLd(landingPage, resolvedSeo)
    : null;
  const faqPageJsonLd = buildFaqPageJsonLd(faqs);

  return (
    <>
      {!preview && webPageJsonLd ? <JsonLd data={webPageJsonLd} /> : null}
      {!preview && organizationJsonLd ? (
        <JsonLd data={organizationJsonLd} />
      ) : null}
      {!preview && faqPageJsonLd ? <JsonLd data={faqPageJsonLd} /> : null}
      {!preview ? <PageViewTracker slug={landingPage.slug} /> : null}
      {resolveTemplateId(landingPage.template) === "template-b" ? (
        <TemplateB landingPage={landingPage} faqs={faqs} preview={preview} />
      ) : (
        <TemplateA landingPage={landingPage} faqs={faqs} preview={preview} />
      )}
    </>
  );
}
