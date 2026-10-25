import { getAbsoluteUrl, getSiteUrl } from "@/lib/site";
import { listText, type HomeContent } from "@/lib/site-home";

/**
 * /llms.txt 본문(순수 함수). llmstxt.org 형식: H1 이름 → 인용문 요약 → H2 목록(링크).
 * 공개 홈과 같은 데이터(buildHomeContent)만 쓴다 — DB에 없는 정보(가격·영업시간·경력 등)는 넣지 않는다.
 */

/** 한 줄로(줄바꿈 제거, 마크다운 링크를 깨는 대괄호·괄호 제거) */
const line = (text: string) => text.replace(/\s+/g, " ").replace(/[[\]()]/g, "").trim();

export function buildLlmsTxt(content: HomeContent): string {
  const name = content.businessName ?? new URL(getSiteUrl()).host;
  const out: string[] = [`# ${line(name)}`, "", `> ${line(content.summary)}`, ""];

  if (content.services.length > 0) {
    out.push("## 서비스");
    for (const service of content.services) {
      const cities = service.cities.map((c) => c.label);
      out.push(`- ${line(service.keyword)}: 안내 페이지 ${service.pageCount}곳${cities.length > 0 ? ` — ${listText(cities, 10)}` : ""}`);
      for (const page of service.pages) {
        out.push(`  - [${line(page.label)}](${getAbsoluteUrl(page.href)})`);
      }
    }
    out.push("");
  }

  if (content.hubs.length > 0) {
    out.push("## 지역별 안내(시/군)");
    for (const hub of content.hubs) {
      out.push(`- [${line(hub.city)}](${getAbsoluteUrl(hub.href)}): ${line(hub.keywords.join(", "))} · ${hub.pageCount}곳`);
    }
    out.push("");
  }

  out.push("## 문의 방법");
  if (content.phone) out.push(`- 전화: ${line(content.phone)}`);
  if (content.kakaoUrl) out.push(`- [카카오톡 상담](${content.kakaoUrl.replace(/[\s()<>]/g, (c) => encodeURIComponent(c))})`);
  out.push("- 각 안내 페이지 하단의 상담 신청 양식");
  out.push("");

  out.push("## 주요 주소");
  out.push(`- [홈](${getAbsoluteUrl("/")})`);
  out.push(`- [사이트맵](${getAbsoluteUrl("/sitemap.xml")}): 공개된 전체 페이지 목록`);
  out.push("");

  return out.join("\n");
}
