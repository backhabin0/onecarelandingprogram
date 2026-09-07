import type { LandingPage } from "@/types/landing-page";
import TemplateA from "@/components/landing/templates/TemplateA";
import TemplateB from "@/components/landing/templates/TemplateB";
import { resolveTemplateId } from "@/components/landing/templates";
import PageViewTracker from "@/components/analytics/PageViewTracker";

interface LandingPageRendererProps {
  landingPage: LandingPage;
}

export default function LandingPageRenderer({
  landingPage,
}: LandingPageRendererProps) {
  return (
    <>
      <PageViewTracker slug={landingPage.slug} />
      {resolveTemplateId(landingPage.template) === "template-b" ? (
        <TemplateB landingPage={landingPage} />
      ) : (
        <TemplateA landingPage={landingPage} />
      )}
    </>
  );
}
