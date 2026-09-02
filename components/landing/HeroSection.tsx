import CTAButtons from "@/components/landing/CTAButtons";

interface HeroSectionProps {
  title: string;
  heroText: string | null;
  mainImageUrl: string | null;
  phone: string | null;
  kakaoUrl: string | null;
}

export default function HeroSection({
  title,
  heroText,
  mainImageUrl,
  phone,
  kakaoUrl,
}: HeroSectionProps) {
  return (
    <section className="bg-slate-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12 sm:py-16 lg:py-20">
        {mainImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mainImageUrl}
            alt={title}
            className="w-full rounded-xl object-cover"
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
        <CTAButtons phone={phone} kakaoUrl={kakaoUrl} />
      </div>
    </section>
  );
}
