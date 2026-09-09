import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLandingPageById } from "@/lib/landing-pages";
import { getSeoSettingsByLandingPageId } from "@/lib/seo-settings";
import { getFaqsByLandingPageId } from "@/lib/faqs";
import { resolveLandingPageFaqs } from "@/lib/faq-resolver";
import LandingPageRenderer from "@/components/landing/LandingPageRenderer";
import AdminPreviewBar from "@/components/admin/AdminPreviewBar";

// 관리자가 저장 직후 최신 상태를 바로 확인해야 하므로 캐시 없이 매번 DB를 조회한다.
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PreviewLandingPagePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PreviewLandingPagePageProps): Promise<Metadata> {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return { robots: { index: false, follow: false } };
  }

  const { data: landingPage } = await getLandingPageById(id);

  return {
    // app/admin/layout.tsx가 이미 /admin 전체를 noindex/nofollow로 막지만,
    // 이 route 자체도 명시적으로 한 번 더 선언한다 — public 페이지용
    // canonical/OG 등 resolveLandingPageSeo 기반 metadata는 여기서 절대 쓰지 않는다.
    title: landingPage ? `[미리보기] ${landingPage.business_name}` : "미리보기",
    robots: { index: false, follow: false },
  };
}

/**
 * 관리자 전용 비공개 랜딩페이지 미리보기(16단계).
 *
 * 인증은 app/admin/layout.tsx의 requireUser()가 이미 이 route를 포함해
 * /admin 이하 전체를 보호하므로 여기서 다시 호출하지 않는다(edit/duplicate
 * 페이지와 동일한 기존 패턴). anon은 이 route에 도달하기 전에 /login으로
 * redirect되고, landing_pages/SEO/FAQ 조회도 authenticated RLS 범위에서만
 * 이뤄진다 — anon 대상 RLS를 전혀 완화하지 않는다.
 *
 * status/slug와 무관하게 id로 직접 조회하므로 private 페이지도 볼 수 있다.
 * 동시에 app/[slug]/page.tsx의 public 조회(getPublicLandingPageBySlug,
 * status='public' 조건)는 전혀 건드리지 않으므로 실제 공개 URL의 404 규칙은
 * 그대로 유지된다.
 *
 * position: fixed로 뷰포트 전체를 덮어 admin 레이아웃(사이드바/헤더/padding)의
 * 영향을 받지 않는 실제 공개 페이지와 동일한 레이아웃을 만든다 — App Router는
 * 같은 /admin 하위 경로에서 조상 layout.tsx를 선택적으로 벗어날 방법이 없으므로,
 * 이 방식으로 "미리보기 bar 외 디자인 차이 없음" 요구를 충족한다.
 */
export default async function PreviewLandingPagePage({
  params,
}: PreviewLandingPagePageProps) {
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

  const resolvedFaqs = resolveLandingPageFaqs(
    landingPage,
    faqs,
    seoSettings?.disable_auto_faq ?? false
  );

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-white">
      <AdminPreviewBar landingPage={landingPage} />
      <LandingPageRenderer
        landingPage={landingPage}
        faqs={resolvedFaqs}
        mode="preview"
      />
    </div>
  );
}
