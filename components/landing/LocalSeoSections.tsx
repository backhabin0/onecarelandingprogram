import Link from "next/link";
import SafeImage from "@/components/landing/SafeImage";
import type { BreadcrumbItem, RelatedLinks } from "@/lib/local-seo";
import type { LandingPhoto } from "@/lib/landing-photos";

/** 화면에 보이는 경로(홈 > 시/군 > 페이지). BreadcrumbList 구조화 데이터와 같은 내용 */
export function Breadcrumbs({ items, variant = "light" }: { items: BreadcrumbItem[]; variant?: "light" | "dark" }) {
  if (items.length < 2) return null;
  const muted = variant === "dark" ? "text-slate-400" : "text-slate-500";
  const strong = variant === "dark" ? "text-slate-200" : "text-slate-700";
  return (
    <nav aria-label="현재 위치" className={`mx-auto max-w-3xl px-5 pt-4 text-xs ${muted}`}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={item.path} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page" className={strong}>
                  {item.name}
                </span>
              ) : (
                <Link href={item.path} className="hover:underline">
                  {item.name}
                </Link>
              )}
              {!last ? <span aria-hidden="true">›</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** 현장 사례(손님이 직접 작성한 내용이 있을 때만) */
export function CaseStudySection({ caseStudy, variant = "light" }: { caseStudy: string | null; variant?: "light" | "dark" }) {
  const text = caseStudy?.trim();
  if (!text) return null;
  const dark = variant === "dark";
  return (
    <section className={dark ? "bg-slate-900" : "border-t border-slate-100 bg-white"}>
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <h2 className={`text-xl font-bold sm:text-2xl ${dark ? "text-white" : "text-slate-900"}`}>현장 사례</h2>
        <p className={`mt-4 whitespace-pre-line text-base leading-relaxed ${dark ? "text-slate-200" : "text-slate-700"}`}>
          {text}
        </p>
      </div>
    </section>
  );
}

/** 페이지 하단 내부 링크: 같은 지역 다른 서비스 / 근처 지역 같은 서비스 / 지역 모음 */
export function RelatedLinksSection({ links, variant = "light" }: { links: RelatedLinks | null; variant?: "light" | "dark" }) {
  if (!links || (links.sameRegion.length === 0 && links.nearby.length === 0 && !links.hub)) return null;
  const dark = variant === "dark";
  const heading = dark ? "text-white" : "text-slate-900";
  const linkClass = dark
    ? "rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
    : "rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50";

  const group = (title: string, items: { href: string; label: string }[]) =>
    items.length > 0 ? (
      <div>
        <h3 className={`text-sm font-semibold ${heading}`}>{title}</h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={linkClass}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <section aria-label="관련 페이지" className={dark ? "border-t border-slate-800 bg-slate-950" : "border-t border-slate-100 bg-white"}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10">
        {group("같은 지역 다른 서비스", links.sameRegion)}
        {group("근처 지역 같은 서비스", links.nearby)}
        {links.hub ? (
          <p className="text-sm">
            <Link href={links.hub.href} className={dark ? "text-orange-300 hover:underline" : "text-blue-700 hover:underline"}>
              {links.hub.label} 보기 →
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** 019: 사진 갤러리(사진 2·3). 본문에 <img alt>로 보여 검색엔진이 사진과 설명을 함께 읽는다 */
export function PhotoGallerySection({ photos, variant = "light" }: { photos: LandingPhoto[]; variant?: "light" | "dark" }) {
  if (photos.length === 0) return null;
  const dark = variant === "dark";
  return (
    <section className={dark ? "bg-slate-950" : "border-t border-slate-100 bg-white"}>
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <h2 className={`text-xl font-bold sm:text-2xl ${dark ? "text-white" : "text-slate-900"}`}>현장 사진</h2>
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {photos.map((photo) => (
            <li key={photo.position}>
              <figure className="flex flex-col gap-2">
                <SafeImage
                  src={photo.url}
                  alt={photo.alt}
                  wrapperClassName="relative aspect-[4/3] w-full overflow-hidden rounded-xl"
                  className="object-cover"
                  sizes="(max-width: 640px) 100vw, 384px"
                />
                <figcaption className={`text-sm ${dark ? "text-slate-300" : "text-slate-600"}`}>{photo.alt}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
