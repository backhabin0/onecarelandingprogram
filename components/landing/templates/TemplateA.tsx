import type { LandingPage } from "@/types/landing-page";
import type { ResolvedFaq } from "@/types/seo";
import type { BreadcrumbItem, RelatedLinks } from "@/lib/local-seo";
import LandingHeader from "@/components/landing/LandingHeader";
import HeroSection from "@/components/landing/HeroSection";
import IntroSection from "@/components/landing/IntroSection";
import BusinessInfoSection from "@/components/landing/BusinessInfoSection";
import CTASection from "@/components/landing/CTASection";
import ConsultationForm from "@/components/landing/ConsultationForm";
import FAQSection from "@/components/landing/FAQSection";
import LandingFooter from "@/components/landing/LandingFooter";
import { Breadcrumbs, CaseStudySection, RelatedLinksSection } from "@/components/landing/LocalSeoSections";

interface TemplateAProps {
  landingPage: LandingPage;
  faqs: ResolvedFaq[];
  /** H1(페이지에 1개). 지역·키워드가 앞쪽에 오도록 다듬은 제목 */
  headline: string;
  /** 대표 사진 alt */
  imageAlt: string;
  /** 화면 상단 경로(홈 > 시/군 > 페이지) */
  breadcrumbs: BreadcrumbItem[];
  /** 하단 내부 링크(공개 페이지에서만) */
  related: RelatedLinks | null;
  /** true면 Analytics 기록/상담 제출을 막는다(관리자 미리보기). 시각적 레이아웃은 동일하다. */
  preview?: boolean;
}

/**
 * 깔끔하고 신뢰감 있는 기본 서비스형 레이아웃.
 * 5단계에서 만든 기본 고객용 페이지 구성을 그대로 사용한다.
 */
export default function TemplateA({
  landingPage,
  faqs,
  headline,
  imageAlt,
  breadcrumbs,
  related,
  preview = false,
}: TemplateAProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <LandingHeader
        businessName={landingPage.business_name}
        logoUrl={landingPage.logo_url}
      />
      <main className="flex-1">
        <Breadcrumbs items={breadcrumbs} />
        <HeroSection
          title={headline}
          imageAlt={imageAlt}
          heroText={landingPage.hero_text}
          mainImageUrl={landingPage.main_image_url}
          phone={landingPage.phone}
          kakaoUrl={landingPage.kakao_url}
          slug={landingPage.slug}
          preview={preview}
        />
        <IntroSection description={landingPage.description} />
        <CaseStudySection caseStudy={landingPage.case_study} />
        <BusinessInfoSection
          businessName={landingPage.business_name}
          address={landingPage.address}
          phone={landingPage.phone}
        />
        <CTASection
          phone={landingPage.phone}
          kakaoUrl={landingPage.kakao_url}
          slug={landingPage.slug}
          preview={preview}
        />
        <section className="border-t border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-xl px-5 py-12 sm:py-16">
            <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
              상담 신청
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              아래 정보를 남겨주시면 빠르게 연락드리겠습니다.
            </p>
            <div className="mt-6">
              <ConsultationForm
                slug={landingPage.slug}
                variant="light"
                preview={preview}
              />
            </div>
          </div>
        </section>
        <FAQSection faqs={faqs} />
        <RelatedLinksSection links={related} />
      </main>
      <LandingFooter businessName={landingPage.business_name} />
    </div>
  );
}
