import { safeJsonLdString } from "@/lib/json-ld";

interface JsonLdProps {
  data: object;
}

/**
 * schema.org JSON-LD 1건을 출력한다. data는 항상 이 앱이 만든 구조화 데이터
 * 객체(lib/structured-data.ts)여야 한다 — 사용자 입력 HTML을 여기 직접
 * 전달하지 않는다.
 */
export default function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdString(data) }}
    />
  );
}
