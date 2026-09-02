import type { LandingPage } from "@/types/landing-page";
import LandingHeader from "@/components/landing/LandingHeader";
import HeroSection from "@/components/landing/HeroSection";
import IntroSection from "@/components/landing/IntroSection";
import BusinessInfoSection from "@/components/landing/BusinessInfoSection";
import CTASection from "@/components/landing/CTASection";
import LandingFooter from "@/components/landing/LandingFooter";

interface TemplateAProps {
  landingPage: LandingPage;
}

/**
 * 깔끔하고 신뢰감 있는 기본 서비스형 레이아웃.
 * 5단계에서 만든 기본 고객용 페이지 구성을 그대로 사용한다.
 */
export default function TemplateA({ landingPage }: TemplateAProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <LandingHeader
        businessName={landingPage.business_name}
        logoUrl={landingPage.logo_url}
      />
      <main className="flex-1">
        <HeroSection
          title={landingPage.title}
          heroText={landingPage.hero_text}
          mainImageUrl={landingPage.main_image_url}
          phone={landingPage.phone}
          kakaoUrl={landingPage.kakao_url}
        />
        <IntroSection description={landingPage.description} />
        <BusinessInfoSection
          businessName={landingPage.business_name}
          address={landingPage.address}
          phone={landingPage.phone}
        />
        <CTASection phone={landingPage.phone} kakaoUrl={landingPage.kakao_url} />
      </main>
      <LandingFooter businessName={landingPage.business_name} />
    </div>
  );
}
