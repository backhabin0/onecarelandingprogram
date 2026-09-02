import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

/**
 * 서버(Server Component / Server Action)에서 사용하는 Supabase 클라이언트.
 *
 * 요청의 쿠키에 담긴 사용자 세션을 그대로 사용하므로, RLS 정책의
 * `authenticated` 검사가 로그인한 사용자에게는 통과하고 비로그인
 * 사용자에게는 거부된다. anon key만 사용한다 — Service Role Key는
 * 절대 사용하지 않는다.
 *
 * Fluid compute 환경을 고려해 전역 변수에 캐시하지 않고 호출마다 새로 만든다.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Component에서 호출된 경우 쿠키를 쓸 수 없다.
          // proxy.ts가 세션 쿠키를 갱신해주므로 무시해도 안전하다.
        }
      },
    },
  });
}
