import type { Metadata } from "next";
import type { LandingPage } from "@/types/landing-page";
import type { LandingPageSeoSettings } from "@/types/seo";
import { resolveLandingPageSeo } from "@/lib/seo-resolver";

export { buildSeoTitle, buildSeoDescription } from "@/lib/seo-auto";

/**
 * public 랜딩페이지 1건에 대한 Next.js Metadata를 만든다.
 * app/[slug]/page.tsx의 generateMetadata에서 사용한다.
 *
 * 실제 title/description/canonical/OG 값 계산은 lib/seo-resolver.ts의
 * resolveLandingPageSeo 한 곳에서만 이뤄진다 — JSON-LD 등 다른 곳에서도
 * 항상 이 resolver의 결과를 그대로 재사용해야 값이 서로 어긋나지 않는다.
 */
export function buildLandingPageMetadata(
  landingPage: LandingPage,
  seoSettings: LandingPageSeoSettings | null
): Metadata {
  const resolved = resolveLandingPageSeo(landingPage, seoSettings);

  return {
    title: resolved.title,
    description: resolved.description,
    alternates: {
      canonical: resolved.canonical,
    },
    openGraph: {
      title: resolved.ogTitle,
      description: resolved.ogDescription,
      url: resolved.canonical,
      type: "website",
      ...(resolved.ogImage ? { images: [{ url: resolved.ogImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: resolved.ogTitle,
      description: resolved.ogDescription,
      ...(resolved.ogImage ? { images: [resolved.ogImage] } : {}),
    },
    robots: resolved.robots,
  };
}
