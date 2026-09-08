import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCachedPublicLandingPageBySlug } from "@/lib/landing-pages";
import { buildLandingPageMetadata } from "@/lib/seo";
import { resolveLandingPageSeo } from "@/lib/seo-resolver";
import { resolveLandingPageFaqs } from "@/lib/faq-resolver";
import LandingPageRenderer from "@/components/landing/LandingPageRenderer";

// 고객용 페이지는 관리자가 상태/내용/템플릿/SEO/FAQ를 바꾸는 즉시 반영되어야
// 하므로 캐시를 두지 않고 매 요청마다 DB를 조회한다.
export const dynamic = "force-dynamic";

interface PublicLandingPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * 존재하지 않거나 private인 slug는 여기서 서버 오류 없이 최소한의 fallback
 * metadata(색인 제외)만 반환하고, 실제 404 처리는 페이지 컴포넌트의
 * notFound()가 그대로 담당한다.
 */
export async function generateMetadata({
  params,
}: PublicLandingPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await getCachedPublicLandingPageBySlug(slug);

  if (!data) {
    return { robots: { index: false, follow: false } };
  }

  return buildLandingPageMetadata(data.landingPage, data.seoSettings);
}

export default async function PublicLandingPage({
  params,
}: PublicLandingPageProps) {
  const { slug } = await params;
  const { data } = await getCachedPublicLandingPageBySlug(slug);

  if (!data) {
    notFound();
  }

  const { landingPage, seoSettings, faqs } = data;
  const resolvedSeo = resolveLandingPageSeo(landingPage, seoSettings);
  const resolvedFaqs = resolveLandingPageFaqs(
    landingPage,
    faqs,
    seoSettings?.disable_auto_faq ?? false
  );

  return (
    <LandingPageRenderer
      landingPage={landingPage}
      resolvedSeo={resolvedSeo}
      faqs={resolvedFaqs}
    />
  );
}
