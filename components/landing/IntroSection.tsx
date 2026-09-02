interface IntroSectionProps {
  description: string | null;
}

export default function IntroSection({ description }: IntroSectionProps) {
  if (!description) {
    return null;
  }

  return (
    <section className="border-t border-slate-100">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <p className="whitespace-pre-line text-base leading-relaxed text-slate-700 sm:text-lg">
          {description}
        </p>
      </div>
    </section>
  );
}
