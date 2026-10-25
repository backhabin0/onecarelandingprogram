import { buildLlmsTxt } from "@/lib/llms-txt";
import { loadHomeContent } from "@/lib/site-home-loader";

// 공개 페이지·대표 업체 설정이 바뀌면 바로 반영되도록 매 요청마다 만든다(sitemap과 같음).
export const dynamic = "force-dynamic";

/** /llms.txt — AI 검색·답변 엔진용 사이트 안내(llmstxt.org 형식, 공개 홈과 같은 데이터) */
export async function GET() {
  const body = buildLlmsTxt(await loadHomeContent());
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
