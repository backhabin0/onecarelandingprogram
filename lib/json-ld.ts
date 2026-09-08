/**
 * JSON-LD 객체를 <script type="application/ld+json"> 안에 안전하게 넣을 수 있는
 * 문자열로 직렬화한다. JSON.stringify는 따옴표/역슬래시는 이스케이프하지만
 * "</script>" 시퀀스는 그대로 통과시키므로, "<" 문자를 유니코드 이스케이프로
 * 바꿔 스크립트 태그 조기 종료(및 그로 인한 XSS)를 막는다.
 *
 * "<" 뿐 아니라 ">"와 "&"도 함께 이스케이프해 HTML 파서가 이 JSON 안의
 * 사용자 입력 문자열(FAQ 답변 등)을 태그/엔티티로 오인하지 않게 한다.
 */
export function safeJsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
