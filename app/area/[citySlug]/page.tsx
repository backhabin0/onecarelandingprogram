import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/landing/LocalSeoSections";
import { buildBreadcrumbJsonLd } from "@/lib/structured-data";
import { getAreaHub } from "@/lib/local-pages";
import { SLUG_PATTERN } from "@/lib/landing-page-validation";
import { areaHubPath, buildHubBreadcrumbs, type AreaHub } from "@/lib/local-seo";
import { getAbsoluteUrl } from "@/lib/site";

// 공개 페이지가 생기거나 바뀌면 바로 반영되도록 매 요청마다 조회한다(/[slug]와 같음).
export const dynamic = "force-dynamic";

interface AreaHubPageProps {
  params: Promise<{ citySlug: string }>;
}

function describeHub(hub: AreaHub, businessNames: string[]) {
  const keywords = hub.groups.map((g) => g.keyword);
  const keywordText = keywords.slice(0, 5).join(", ") + (keywords.length > 5 ? " 등" : "");
  const title = `${hub.city} ${keywordText} 지역 안내`;
  const business = businessNames.length === 1 ? businessNames[0] : null;
  const description = `${hub.city}의 동네별 ${keywordText} 안내 페이지 ${hub.pageCount}곳을 모았습니다.${
    business ? ` ${business}` : ""
  }`.trim();
  return { title: business ? `${title} | ${business}` : title, description };
}

async function loadHub(citySlug: string) {
  if (!SLUG_PATTERN.test(citySlug)) return null;
  const { hub, businessNames } = await getAreaHub(citySlug);
  return hub ? { hub, businessNames } : null;
}

export async function generateMetadata({ params }: AreaHubPageProps): Promise<Metadata> {
  const { citySlug } = await params;
  const loaded = await loadHub(citySlug);
  if (!loaded) return { robots: { index: false, follow: false } };

  const { title, description } = describeHub(loaded.hub, loaded.businessNames);
  const canonical = getAbsoluteUrl(areaHubPath(citySlug));
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    robots: { index: true, follow: true },
  };
}

/**
 * 지역 모음 페이지: 한 시/군의 공개 페이지(noindex 제외)를 키워드별로 묶어 링크한다.
 * 공개 페이지가 하나도 없으면 404. 검색엔진이 같은 시/군의 페이지들을 발견하고
 * 관계를 이해하도록 돕는 탐색용 페이지다(내용을 부풀리지 않는다).
 */
export default async function AreaHubPage({ params }: AreaHubPageProps) {
  const { citySlug } = await params;
  const loaded = await loadHub(citySlug);
  if (!loaded) notFound();

  const { hub, businessNames } = loaded;
  const { description } = describeHub(hub, businessNames);
  // 경로: 홈 › 시/군 (화면 표시와 BreadcrumbList가 같은 내용)
  const breadcrumbs = buildHubBreadcrumbs(hub);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbs);
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${hub.city} 지역 안내`,
    itemListElement: hub.groups
      .flatMap((g) => g.pages)
      .map((page, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: getAbsoluteUrl(page.href),
        name: page.label,
      })),
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <JsonLd data={itemListJsonLd} />
      {breadcrumbJsonLd ? <JsonLd data={breadcrumbJsonLd} /> : null}
      <main className="flex-1">
        <Breadcrumbs items={breadcrumbs} />
        <section className="bg-slate-50">
          <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
            <h1 className="text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">{hub.city} 지역 안내</h1>
            <p className="mt-3 text-base text-slate-600">{description}</p>
          </div>
        </section>
        <div className="mx-auto flex max-w-3xl flex-col gap-10 px-5 py-12">
          {hub.groups.map((group) => (
            <section key={group.keyword}>
              <h2 className="text-xl font-bold text-slate-900">
                {hub.city} {group.keyword}
              </h2>
              <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.pages.map((page) => (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      className="block rounded-lg border border-slate-200 px-4 py-3 text-slate-800 hover:bg-slate-50"
                    >
                      {page.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
