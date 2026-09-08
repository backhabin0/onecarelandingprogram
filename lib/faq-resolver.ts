import type { LandingPage } from "@/types/landing-page";
import type { LandingPageFaq, ResolvedFaq } from "@/types/seo";

/**
 * DB에 실제로 존재하는 값만으로 답변 가능한 FAQ만 자동 생성한다.
 * 운영시간/가격/주차/휴무일 등 landing_pages에 없는 정보는 절대 추측하지 않는다.
 * 상담 신청 폼은 모든 템플릿에 항상 렌더링되는 구조적 요소이므로 데이터 유무와
 * 무관하게 포함한다.
 */
export function buildAutomaticFaqs(landingPage: LandingPage): ResolvedFaq[] {
  const faqs: ResolvedFaq[] = [];
  const businessName = landingPage.business_name.trim();

  const aboutAnswer = landingPage.description?.trim() || landingPage.hero_text?.trim();
  if (aboutAnswer) {
    faqs.push({
      question: `${businessName}은 어떤 곳인가요?`,
      answer: aboutAnswer,
    });
  }

  if (landingPage.address?.trim()) {
    faqs.push({
      question: `${businessName} 위치는 어디인가요?`,
      answer: `${landingPage.address.trim()}에 위치해 있습니다.`,
    });
  }

  if (landingPage.phone?.trim()) {
    faqs.push({
      question: "전화 상담은 어떻게 하나요?",
      answer: `${landingPage.phone.trim()}로 전화 주시면 바로 상담 가능합니다.`,
    });
  }

  if (landingPage.kakao_url?.trim()) {
    faqs.push({
      question: "카카오톡 상담이 가능한가요?",
      answer: "네, 페이지의 카카오톡 상담 버튼을 통해 문의하실 수 있습니다.",
    });
  }

  faqs.push({
    question: "온라인 상담 신청이 가능한가요?",
    answer: "네, 페이지 하단의 상담 신청 폼을 통해 접수하실 수 있습니다.",
  });

  return faqs;
}

/** 질문 텍스트를 공백/구두점 차이를 무시하고 비교하기 위해 정규화한다. */
function normalizeQuestion(question: string): string {
  return question
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[?？.!。,，]/g, "");
}

/**
 * 자동 FAQ + 활성 수동 FAQ를 합쳐 화면/JSON-LD에 그대로 쓸 최종 목록을 만든다.
 * - disableAutoFaq가 true면 자동 FAQ는 완전히 제외한다.
 * - 질문이 사실상 같으면 수동 FAQ(관리자가 직접 작성한 답변)를 우선한다.
 * - 결과가 비어 있으면 빈 배열을 반환한다 — 호출부는 이 경우 FAQ 섹션 자체를
 *   렌더링하지 않는다.
 */
export function resolveLandingPageFaqs(
  landingPage: LandingPage,
  manualFaqs: LandingPageFaq[],
  disableAutoFaq: boolean
): ResolvedFaq[] {
  const activeManualFaqs = manualFaqs
    .filter((faq) => faq.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((faq) => ({ question: faq.question, answer: faq.answer }));

  if (disableAutoFaq) {
    return activeManualFaqs;
  }

  const manualQuestionKeys = new Set(
    activeManualFaqs.map((faq) => normalizeQuestion(faq.question))
  );

  const autoFaqs = buildAutomaticFaqs(landingPage).filter(
    (faq) => !manualQuestionKeys.has(normalizeQuestion(faq.question))
  );

  return [...autoFaqs, ...activeManualFaqs];
}
