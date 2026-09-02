import type { Template } from "@/types/landing-page";

/**
 * 템플릿 목록은 아직 DB 테이블이 없어 이 mock 데이터를 그대로 사용한다.
 * 랜딩페이지 데이터는 lib/landing-pages.ts를 통해 Supabase에서 조회한다.
 */
export const mockTemplates: Template[] = [
  {
    id: "template-a",
    name: "템플릿 A",
    description: "심플한 상담 신청형 레이아웃",
  },
  {
    id: "template-b",
    name: "템플릿 B",
    description: "이미지 강조형 홍보 레이아웃",
  },
];

export function getTemplateLabel(templateId: string): string {
  return mockTemplates.find((template) => template.id === templateId)?.name ?? templateId;
}
