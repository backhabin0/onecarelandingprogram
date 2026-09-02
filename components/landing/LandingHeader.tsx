interface LandingHeaderProps {
  businessName: string;
  logoUrl: string | null;
}

export default function LandingHeader({
  businessName,
  logoUrl,
}: LandingHeaderProps) {
  return (
    <header className="border-b border-slate-100 bg-white">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={businessName}
            className="h-8 w-8 shrink-0 rounded object-contain"
          />
        ) : null}
        <span className="truncate text-base font-semibold text-slate-900">
          {businessName}
        </span>
      </div>
    </header>
  );
}
