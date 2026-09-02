import type { LandingPage } from "@/types/landing-page";
import LandingHeader from "@/components/landing/LandingHeader";
import BusinessInfoSection from "@/components/landing/BusinessInfoSection";
import LandingFooter from "@/components/landing/LandingFooter";
import CTAButtons from "@/components/landing/CTAButtons";

interface TemplateBProps {
  landingPage: LandingPage;
}

/**
 * 프로모션/이벤트 중심의 강한 CTA 레이아웃.
 * Template A와 달리 hero_text를 Hero에 묶지 않고 별도의 "핵심 혜택 강조" 배너로
 * 분리해 두 템플릿의 섹션 구성 자체가 다르게 보이도록 한다.
 */
export default function TemplateB({ landingPage }: TemplateBProps) {
  const {
    business_name: businessName,
    title,
    hero_text: heroText,
    description,
    phone,
    kakao_url: kakaoUrl,
    address,
    logo_url: logoUrl,
    main_image_url: mainImageUrl,
  } = landingPage;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      <LandingHeader businessName={businessName} logoUrl={logoUrl} />

      <main className="flex-1">
        <section className="relative overflow-hidden bg-slate-900">
          {mainImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mainImageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-50"
            />
          ) : null}
          <div className="relative mx-auto flex max-w-3xl flex-col items-start gap-6 px-5 py-16 sm:py-24 lg:py-28">
            <span className="rounded-full bg-orange-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              지금 바로 신청하세요
            </span>
            <h1 className="text-4xl font-extrabold leading-tight text-white sm:text-5xl lg:text-6xl">
              {title}
            </h1>
            <CTAButtons phone={phone} kakaoUrl={kakaoUrl} size="lg" />
          </div>
        </section>

        {heroText ? (
          <section className="bg-orange-500">
            <div className="mx-auto max-w-3xl px-5 py-8 text-center sm:py-10">
              <p className="text-lg font-bold text-white sm:text-2xl">
                {heroText}
              </p>
            </div>
          </section>
        ) : null}

        {description ? (
          <section className="bg-slate-950">
            <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-orange-400">
                소개
              </h2>
              <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-slate-200 sm:text-lg">
                {description}
              </p>
            </div>
          </section>
        ) : null}

        <BusinessInfoSection
          businessName={businessName}
          address={address}
          phone={phone}
        />

        {phone || kakaoUrl ? (
          <section className="bg-orange-500">
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-5 py-14 text-center sm:py-20">
              <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
                놓치면 후회하는 특별 혜택, 지금 상담하세요
              </h2>
              <CTAButtons phone={phone} kakaoUrl={kakaoUrl} size="lg" />
            </div>
          </section>
        ) : null}
      </main>

      <LandingFooter businessName={businessName} />
    </div>
  );
}
