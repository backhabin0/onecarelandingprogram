interface LandingFooterProps {
  businessName: string;
}

export default function LandingFooter({ businessName }: LandingFooterProps) {
  return (
    <footer className="border-t border-slate-100 bg-slate-50">
      <div className="mx-auto max-w-3xl px-5 py-6 text-center text-xs text-slate-400">
        © {businessName}
      </div>
    </footer>
  );
}
