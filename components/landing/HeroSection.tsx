import CTAButtons from "@/components/landing/CTAButtons";
import SafeImage from "@/components/landing/SafeImage";

interface HeroSectionProps {
  /** H1에 쓸 머리말(지역·키워드가 앞쪽에 오도록 다듬은 제목) */
  title: string;
  /** 대표 사진 alt(입력값 또는 "지역 키워드 현장") */
  imageAlt: string;
  heroText: string | null;
  mainImageUrl: string | null;
  phone: string | null;
  kakaoUrl: string | null;
  slug: string;
  preview?: boolean;
}

export default function HeroSection({
  title,
  imageAlt,
  heroText,
  mainImageUrl,
  phone,
  kakaoUrl,
  slug,
  preview = false,
}: HeroSectionProps) {
  return (
    <section className="bg-slate-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12 sm:py-16 lg:py-20">
        {mainImageUrl ? (
          <SafeImage
            src={mainImageUrl}
            alt={imageAlt}
            wrapperClassName="relative aspect-[16/9] w-full overflow-hidden rounded-xl"
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 768px"
            highPriority
          />
        ) : null}
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-bold leading-tight text-slate-900 sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          {heroText ? (
            <p className="text-lg text-slate-600 sm:text-xl">{heroText}</p>
          ) : null}
        </div>
        <CTAButtons phone={phone} kakaoUrl={kakaoUrl} slug={slug} preview={preview} />
      </div>
    </section>
  );
}
