import type { FakeSupabase } from "./fake-supabase";

/**
 * tests/setup.ts가 "@/lib/supabase/server"를 모킹해서, lib/ 코드가
 * getSupabaseServerClient()를 부르면 여기 등록된 가짜 클라이언트를 받게 한다.
 * 실제 Supabase(운영/테스트 DB)에는 절대 연결되지 않는다.
 */
let current: FakeSupabase | null = null;

export function setFakeSupabase(fake: FakeSupabase): FakeSupabase {
  current = fake;
  return fake;
}

export function getCurrentFakeSupabase(): FakeSupabase {
  if (!current) {
    throw new Error("[tests] setFakeSupabase()로 가짜 클라이언트를 먼저 등록하세요.");
  }
  return current;
}
