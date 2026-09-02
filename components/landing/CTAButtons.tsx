interface CTAButtonsProps {
  phone: string | null;
  kakaoUrl: string | null;
}

export default function CTAButtons({ phone, kakaoUrl }: CTAButtonsProps) {
  if (!phone && !kakaoUrl) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {phone ? (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-blue-600 px-6 text-base font-semibold text-white active:bg-blue-700 sm:min-h-14 sm:text-lg"
        >
          전화 상담하기
        </a>
      ) : null}
      {kakaoUrl ? (
        <a
          href={kakaoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-yellow-400 px-6 text-base font-semibold text-slate-900 active:bg-yellow-500 sm:min-h-14 sm:text-lg"
        >
          카카오톡 상담
        </a>
      ) : null}
    </div>
  );
}
