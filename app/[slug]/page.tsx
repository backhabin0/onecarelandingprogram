import { notFound } from "next/navigation";
import { getPublicLandingPageBySlug } from "@/lib/landing-pages";
import LandingPageRenderer from "@/components/landing/LandingPageRenderer";

// 고객용 페이지는 관리자가 상태/내용/템플릿을 바꾸는 즉시 반영되어야 하므로
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

  return <LandingPageRenderer landingPage={landingPage} />;
}
