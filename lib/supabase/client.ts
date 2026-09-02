import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

/**
 * 브라우저(Client Component)에서 사용하는 Supabase 클라이언트.
 * 쿠키 기반 세션을 사용하며, anon key만 사용한다.
 * 현재 단계에서는 실제로 호출하는 곳이 없다 —
 * 이후 단계에서 클라이언트 측 상호작용이 필요할 때를 위한 구조.
 */
export function getSupabaseBrowserClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
}
