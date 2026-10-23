import "server-only";

import { after } from "next/server";
import { autoSubmitIndexNow, getIndexNowConfig } from "@/lib/indexnow";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * 관리자 화면(Server Component)에서 부른다. 응답을 보낸 뒤(after) IndexNow 자동 전송을 한다.
 *
 * Server Component의 after() 안에서는 cookies()를 쓸 수 없으므로(Next.js after 문서),
 * 로그인 세션이 담긴 Supabase 클라이언트를 렌더링 중에 미리 만들어 넘긴다.
 * 요청 밖(테스트·빌드)에서는 after()가 예외를 던지므로 조용히 건너뛴다.
 */
export async function scheduleAutoIndexNow(): Promise<void> {
  if (!getIndexNowConfig().ok) return;
  try {
    const supabase = await getSupabaseServerClient();
    after(async () => {
      await autoSubmitIndexNow(supabase);
    });
  } catch {
    // 요청 범위 밖이면 자동 전송하지 않는다.
  }
}
