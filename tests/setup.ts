import { vi } from "vitest";
import { getCurrentFakeSupabase } from "./helpers/current-supabase";

// 모든 테스트에서 Supabase 서버 클라이언트를 가짜로 바꾼다 — 네트워크 연결 없음.
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => getCurrentFakeSupabase(),
}));

// 관리자 인증은 테스트 범위 밖이므로 항상 통과시킨다.
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "test-admin" }),
}));

// 실제 서비스 URL이 섞이지 않도록 사이트 URL을 고정한다.
process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
