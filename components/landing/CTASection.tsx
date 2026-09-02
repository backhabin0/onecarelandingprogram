import CTAButtons from "@/components/landing/CTAButtons";

interface CTASectionProps {
  phone: string | null;
  kakaoUrl: string | null;
}

export default function CTASection({ phone, kakaoUrl }: CTASectionProps) {
  if (!phone && !kakaoUrl) {
    return null;
  }

  return (
    <section className="border-t border-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-5 py-12 sm:items-center sm:py-16 sm:text-center">
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">
          지금 바로 상담을 시작해보세요
        </h2>
        <CTAButtons phone={phone} kakaoUrl={kakaoUrl} />
      </div>
    </section>
  );
}
