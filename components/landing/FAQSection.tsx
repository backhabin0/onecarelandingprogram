import type { ResolvedFaq } from "@/types/seo";

interface FAQSectionProps {
  faqs: ResolvedFaq[];
  variant?: "light" | "dark";
}

/**
 * 자동 FAQ + 수동 FAQ(중복 제거 완료)를 실제 HTML 텍스트로 렌더링한다.
 * 클라이언트에서 나중에 불러오지 않고 서버 렌더링 시점에 포함되므로
 * 검색엔진/AI crawler가 별도 JS 실행 없이 그대로 읽을 수 있다.
 * Template A/B 모두 이 컴포넌트를 사용해 FAQ 구조를 동일하게 유지한다
 * (variant는 각 템플릿의 배경색에 맞춘 색상 대비용일 뿐, 데이터/구조는 동일).
 */
export default function FAQSection({ faqs, variant = "light" }: FAQSectionProps) {
  if (faqs.length === 0) return null;

  const isDark = variant === "dark";

  return (
    <section
      className={`border-t ${isDark ? "border-slate-800" : "border-slate-100"}`}
    >
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <h2
          className={`text-xl font-bold sm:text-2xl ${
            isDark ? "text-white" : "text-slate-900"
          }`}
        >
          자주 묻는 질문
        </h2>
        <div className="mt-6 flex flex-col gap-6">
          {faqs.map((faq, index) => (
            <div key={index}>
              <h3
                className={`text-base font-semibold sm:text-lg ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                {faq.question}
              </h3>
              <p
                className={`mt-2 whitespace-pre-line text-sm leading-relaxed sm:text-base ${
                  isDark ? "text-slate-300" : "text-slate-600"
                }`}
              >
                {faq.answer}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
