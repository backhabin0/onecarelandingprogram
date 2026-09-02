import type { LandingPageTemplateId } from "@/types/landing-page";

export const DEFAULT_TEMPLATE_ID: LandingPageTemplateId = "template-a";

const KNOWN_TEMPLATE_IDS: readonly LandingPageTemplateId[] = [
  "template-a",
  "template-b",
];

/**
 * DB의 template 값(자유 문자열)을 알려진 템플릿 id로 정규화한다.
 * 알 수 없는 값이 저장되어 있어도 페이지가 깨지지 않도록 기본 템플릿으로 fallback한다.
 * 새 템플릿을 추가할 때는 이 배열과 LandingPageRenderer의 switch에 한 줄씩 추가하면 된다.
 */
export function resolveTemplateId(templateId: string): LandingPageTemplateId {
  return (KNOWN_TEMPLATE_IDS as readonly string[]).includes(templateId)
    ? (templateId as LandingPageTemplateId)
    : DEFAULT_TEMPLATE_ID;
}
