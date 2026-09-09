import { notFound } from "next/navigation";
import PageHeader from "@/components/admin/PageHeader";
import DuplicateLandingPageForm from "@/components/admin/DuplicateLandingPageForm";
import { getLandingPageById, suggestDuplicateSlug } from "@/lib/landing-pages";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DuplicateLandingPagePageProps {
  params: Promise<{ id: string }>;
}

export default async function DuplicateLandingPagePage({
  params,
}: DuplicateLandingPagePageProps) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const { data: landingPage, error } = await getLandingPageById(id);

  if (error || !landingPage) {
    notFound();
  }

  const suggestedSlug = await suggestDuplicateSlug(landingPage.slug);

  return (
    <div>
      <PageHeader
        title="랜딩페이지 복제"
        description={`${landingPage.business_name} 페이지를 새 랜딩페이지로 복제합니다.`}
      />
      <DuplicateLandingPageForm
        sourceId={landingPage.id}
        sourceBusinessName={landingPage.business_name}
        sourceSlug={landingPage.slug}
        defaultBusinessName={`${landingPage.business_name} 복사본`}
        defaultTitle={landingPage.title}
        defaultSlug={suggestedSlug}
      />
    </div>
  );
}
