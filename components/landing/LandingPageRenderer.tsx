import type { LandingPage } from "@/types/landing-page";
import TemplateA from "@/components/landing/templates/TemplateA";
import TemplateB from "@/components/landing/templates/TemplateB";
import { resolveTemplateId } from "@/components/landing/templates";

interface LandingPageRendererProps {
  landingPage: LandingPage;
}

export default function LandingPageRenderer({
  landingPage,
}: LandingPageRendererProps) {
  switch (resolveTemplateId(landingPage.template)) {
    case "template-b":
      return <TemplateB landingPage={landingPage} />;
    case "template-a":
    default:
      return <TemplateA landingPage={landingPage} />;
  }
}
