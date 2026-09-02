import type { Template } from "@/types/landing-page";

/**
 * 템플릿 목록은 아직 DB 테이블이 없어 이 mock 데이터를 그대로 사용한다.
 * 랜딩페이지 데이터는 lib/landing-pages.ts를 통해 Supabase에서 조회한다.
 */
export const mockTemplates: Template[] = [
  {
    id: "template-a",
    name: "템플릿 A",
    description: "깔끔하고 신뢰감 있는 기본 서비스형 레이아웃",
    features: [
      "밝은 배경과 카드형 UI",
      "차분한 블루 톤 CTA 버튼",
      "기업/서비스 신뢰감 강조",
    ],
    available: true,
  },
  {
    id: "template-b",
    name: "템플릿 B",
    description: "프로모션/이벤트 중심의 강한 CTA 레이아웃",
    features: [
      "큰 비주얼 Hero",
      "핵심 혜택 강조 배너",
      "대비가 강한 CTA 섹션",
    ],
    available: true,
  },
];

export function getTemplateLabel(templateId: string): string {
  return mockTemplates.find((template) => template.id === templateId)?.name ?? templateId;
}
