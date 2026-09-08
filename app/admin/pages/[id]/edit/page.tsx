import { notFound } from "next/navigation";
import PageHeader from "@/components/admin/PageHeader";
import LandingPageForm from "@/components/admin/LandingPageForm";
import SeoSettingsPanel from "@/components/admin/SeoSettingsPanel";
import FaqManager from "@/components/admin/FaqManager";
import { getLandingPageById } from "@/lib/landing-pages";
import { getSeoSettingsByLandingPageId } from "@/lib/seo-settings";
import { getFaqsByLandingPageId } from "@/lib/faqs";
import { buildAutomaticFaqs } from "@/lib/faq-resolver";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EditLandingPagePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditLandingPagePage({
  params,
}: EditLandingPagePageProps) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const { data: landingPage, error } = await getLandingPageById(id);

  if (error || !landingPage) {
    notFound();
  }

  const [{ data: seoSettings }, { data: faqs }] = await Promise.all([
    getSeoSettingsByLandingPageId(id),
    getFaqsByLandingPageId(id),
  ]);

  return (
    <div>
      <PageHeader
        title="랜딩페이지 수정"
        description={`${landingPage.business_name} 페이지 정보를 수정하세요.`}
      />
      <div className="flex flex-col gap-6">
        <LandingPageForm
          mode="edit"
          landingPageId={landingPage.id}
          initialValues={{
            businessName: landingPage.business_name,
            title: landingPage.title,
            slug: landingPage.slug,
            heroText: landingPage.hero_text ?? "",
            description: landingPage.description ?? "",
            phone: landingPage.phone ?? "",
            kakaoUrl: landingPage.kakao_url ?? "",
            address: landingPage.address ?? "",
            template: landingPage.template,
            status: landingPage.status,
          }}
          initialLogoUrl={landingPage.logo_url}
          initialMainImageUrl={landingPage.main_image_url}
        />
        <SeoSettingsPanel
          landingPage={landingPage}
          initialSeoSettings={seoSettings}
          autoFaqCount={buildAutomaticFaqs(landingPage).length}
          manualFaqCount={faqs.length}
        />
        <FaqManager
          landingPageId={landingPage.id}
          slug={landingPage.slug}
          initialFaqs={faqs}
        />
      </div>
    </div>
  );
}
