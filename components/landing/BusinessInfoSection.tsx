interface BusinessInfoSectionProps {
  businessName: string;
  address: string | null;
  phone: string | null;
}

export default function BusinessInfoSection({
  businessName,
  address,
  phone,
}: BusinessInfoSectionProps) {
  return (
    <section className="border-t border-slate-100 bg-slate-50">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">
          업체 정보
        </h2>
        <dl className="mt-4 flex flex-col gap-2 text-sm text-slate-600 sm:text-base">
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-slate-500">업체명</dt>
            <dd>{businessName}</dd>
          </div>
          {address ? (
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-slate-500">주소</dt>
              <dd>{address}</dd>
            </div>
          ) : null}
          {phone ? (
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-slate-500">전화번호</dt>
              <dd>{phone}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
