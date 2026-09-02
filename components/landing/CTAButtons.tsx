interface CTAButtonsProps {
  phone: string | null;
  kakaoUrl: string | null;
  size?: "md" | "lg";
}

const SIZE_CLASSNAMES: Record<"md" | "lg", string> = {
  md: "min-h-12 px-6 text-base sm:min-h-14 sm:text-lg",
  lg: "min-h-14 px-8 text-lg sm:min-h-16 sm:text-xl",
};

export default function CTAButtons({
  phone,
  kakaoUrl,
  size = "md",
}: CTAButtonsProps) {
  if (!phone && !kakaoUrl) {
    return null;
  }

  const sizeClassName = SIZE_CLASSNAMES[size];

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {phone ? (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          className={`inline-flex items-center justify-center rounded-lg bg-blue-600 font-semibold text-white active:bg-blue-700 ${sizeClassName}`}
        >
          전화 상담하기
        </a>
      ) : null}
      {kakaoUrl ? (
        <a
          href={kakaoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center justify-center rounded-lg bg-yellow-400 font-semibold text-slate-900 active:bg-yellow-500 ${sizeClassName}`}
        >
          카카오톡 상담
        </a>
      ) : null}
    </div>
  );
}
