import { notFound } from "next/navigation";
import { getPublicLandingPageBySlug } from "@/lib/landing-pages";
import LandingHeader from "@/components/landing/LandingHeader";
import HeroSection from "@/components/landing/HeroSection";
import IntroSection from "@/components/landing/IntroSection";
import BusinessInfoSection from "@/components/landing/BusinessInfoSection";
import CTASection from "@/components/landing/CTASection";
import LandingFooter from "@/components/landing/LandingFooter";

// 고객용 페이지는 관리자가 상태/내용을 바꾸는 즉시 반영되어야 하므로
// 캐시를 두지 않고 매 요청마다 DB를 조회한다.
export const dynamic = "force-dynamic";

interface PublicLandingPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PublicLandingPage({
  params,
}: PublicLandingPageProps) {
  const { slug } = await params;
  const { data: landingPage } = await getPublicLandingPageBySlug(slug);

  if (!landingPage) {
    notFound();
  }

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
