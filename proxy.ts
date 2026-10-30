import { updateSession } from "@/lib/supabase/proxy";
import { redirectLandingPage } from "@/lib/supabase/redirect-proxy";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // 합쳐진 옛 랜딩페이지 주소는 렌더링 전에 새 주소로 301 이동(migration 020)
  const redirect = await redirectLandingPage(request);
  if (redirect) return redirect;
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 다음 경로는 제외하고 모든 요청에서 실행한다:
     * - _next/static (정적 파일)
     * - _next/image (이미지 최적화 파일)
     * - favicon.ico
     * - 이미지 확장자 (.svg, .png, .jpg, .jpeg, .gif, .webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
