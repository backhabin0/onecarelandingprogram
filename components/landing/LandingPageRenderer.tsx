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
  resolvedSeo: ResolvedLandingPageSeo;
  faqs: ResolvedFaq[];
}

export default function LandingPageRenderer({
  landingPage,
  resolvedSeo,
  faqs,
}: LandingPageRendererProps) {
  const webPageJsonLd = buildWebPageJsonLd(landingPage, resolvedSeo);
  const organizationJsonLd = buildOrganizationJsonLd(landingPage, resolvedSeo);
  const faqPageJsonLd = buildFaqPageJsonLd(faqs);

  return (
    <>
      <JsonLd data={webPageJsonLd} />
      <JsonLd data={organizationJsonLd} />
      {faqPageJsonLd ? <JsonLd data={faqPageJsonLd} /> : null}
      <PageViewTracker slug={landingPage.slug} />
      {resolveTemplateId(landingPage.template) === "template-b" ? (
        <TemplateB landingPage={landingPage} faqs={faqs} />
      ) : (
        <TemplateA landingPage={landingPage} faqs={faqs} />
      )}
    </>
  );
}
