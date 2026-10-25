import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/components/seo/JsonLd";
import { loadHomeContent } from "@/lib/site-home-loader";
import { buildHomeTitle } from "@/lib/site-home";
import { getAbsoluteUrl } from "@/lib/site";
import { buildSiteBusinessJsonLd, buildWebSiteJsonLd } from "@/lib/structured-data";

// 공개 페이지·대표 업체 설정이 바뀌면 바로 반영되도록 매 요청마다 조회한다(/[slug]와 같음).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const content = await loadHomeContent();
  const title = buildHomeTitle(content);
  const canonical = getAbsoluteUrl("/");
  return {
    title,
    description: content.summary,
    alternates: { canonical },
    openGraph: { title, description: content.summary, url: canonical, type: "website", locale: "ko_KR" },
    robots: { index: true, follow: true },
  };
}

/**
 * 공개 홈. 대표 업체 소개(관리자 설정에 입력한 값만) + 서비스(키워드)별 + 지역(시/군 모음)별 링크.
 * 관리자 화면은 /admin 그대로다(이 페이지에서 링크하지 않음).
 * 디자인은 랜딩 템플릿 A와 같은 톤(흰 배경, slate 글자, max-w-3xl 단).
 */
export default async function HomePage() {
  const content = await loadHomeContent();
  const site = {
    businessName: content.businessName,
    description: content.summary,
    phone: content.phone,
    kakaoUrl: content.kakaoUrl,
  };
  const businessJsonLd = buildSiteBusinessJsonLd(site, content.hubs.map((hub) => hub.city));
  const heading = content.businessName ?? buildHomeTitle(content);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <JsonLd data={buildWebSiteJsonLd(content.businessName ? site : null, content.summary)} />
      {businessJsonLd ? <JsonLd data={businessJsonLd} /> : null}

      {content.businessName ? (
        <header className="border-b border-slate-100 bg-white">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
            <span className="truncate text-base font-semibold text-slate-900">{content.businessName}</span>
          </div>
        </header>
      ) : null}

      <main className="flex-1">
        <section className="bg-slate-50">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-12 sm:py-16 lg:py-20">
            <h1 className="text-3xl font-bold leading-tight text-slate-900 sm:text-4xl lg:text-5xl">{heading}</h1>
            <p className="text-lg text-slate-600 sm:text-xl">{content.summary}</p>
            {content.phone || content.kakaoUrl ? (
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                {content.phone ? (
                  <a
                    href={`tel:${content.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex min-h-12 items-center justify-center rounded-lg bg-blue-600 px-6 text-base font-semibold text-white active:bg-blue-700 sm:min-h-14 sm:text-lg"
                  >
                    전화 상담하기
                  </a>
                ) : null}
                {content.kakaoUrl ? (
                  <a
                    href={content.kakaoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-12 items-center justify-center rounded-lg bg-yellow-400 px-6 text-base font-semibold text-slate-900 active:bg-yellow-500 sm:min-h-14 sm:text-lg"
                  >
                    카카오톡 상담
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {content.services.length > 0 ? (
          <section aria-labelledby="home-services" className="border-t border-slate-100">
            <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
              <h2 id="home-services" className="text-xl font-bold text-slate-900 sm:text-2xl">
                서비스별 안내
              </h2>
              <div className="mt-6 flex flex-col gap-8">
                {content.services.map((service) => (
                  <div key={service.keyword}>
                    <h3 className="text-base font-semibold text-slate-900 sm:text-lg">
                      {service.keyword} <span className="text-sm font-normal text-slate-500">({service.pageCount}곳)</span>
                    </h3>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {service.pages.map((page) => (
                        <li key={page.href}>
                          <Link
                            href={page.href}
                            className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            {page.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {service.cities.length > 0 && service.pageCount > service.pages.length ? (
                      <p className="mt-3 text-sm text-slate-500">
                        더 보기:{" "}
                        {service.cities.map((city, index) => (
                          <span key={city.href}>
                            {index > 0 ? ", " : null}
                            <Link href={city.href} className="text-blue-700 hover:underline">
                              {city.label}
                            </Link>
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {content.hubs.length > 0 ? (
          <section aria-labelledby="home-areas" className="border-t border-slate-100 bg-slate-50">
            <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
              <h2 id="home-areas" className="text-xl font-bold text-slate-900 sm:text-2xl">
                지역별 안내
              </h2>
              <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {content.hubs.map((hub) => (
                  <li key={hub.href}>
                    <Link
                      href={hub.href}
                      className="block rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 hover:bg-slate-50"
                    >
                      <span className="font-semibold">{hub.city}</span>
                      <span className="mt-1 block text-sm text-slate-500">
                        {hub.keywords.join(", ")} · {hub.pageCount}곳
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-3xl px-5 py-6 text-center text-xs text-slate-400">
          {content.businessName ? `© ${content.businessName}` : new URL(getAbsoluteUrl("/")).host}
        </div>
      </footer>
    </div>
  );
}
