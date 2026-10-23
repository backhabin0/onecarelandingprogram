import type { FakeSupabase } from "./fake-supabase";
import type { PgliteSupabase } from "./pglite-supabase";

/**
 * tests/setup.ts가 "@/lib/supabase/server"를 모킹해서, lib/ 코드가
 * getSupabaseServerClient()를 부르면 여기 등록된 가짜 클라이언트를 받게 한다.
 * - FakeSupabase: 메모리 데이터(1,000행 제한 흉내)
 * - PgliteSupabase: 컴퓨터 안의 Postgres(PGlite)에 migration을 적용한 DB
 * 실제 Supabase(운영/테스트 DB)에는 절대 연결되지 않는다.
 */
type TestClient = FakeSupabase | PgliteSupabase;

let current: TestClient | null = null;

export function setFakeSupabase<T extends TestClient>(fake: T): T {
  current = fake;
  return fake;
}

export function getCurrentFakeSupabase(): TestClient {
  if (!current) {
    throw new Error("[tests] setFakeSupabase()로 가짜 클라이언트를 먼저 등록하세요.");
  }
  return current;
}
