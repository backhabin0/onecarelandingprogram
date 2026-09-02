import "server-only";

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/**
 * 현재 로그인한 사용자를 반환한다. 세션이 없거나 유효하지 않으면 null.
 * Supabase Auth 서버에 직접 검증하는 getUser()를 사용한다(로컬 디코딩이 아님).
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

/**
 * 로그인한 사용자를 요구한다. 세션이 없으면 /login으로 redirect한다.
 *
 * proxy.ts가 1차 방어선이고, 이 함수는 app/admin/layout.tsx에서 호출되는
 * 2차 방어선(+ 관리자 이메일 표시용 데이터 소스)이다.
 *
 * TODO(향후 단계): 여러 관리자 권한을 구분해야 하면 이 함수에서
 * user의 role/metadata를 함께 검사하도록 확장한다. 지금은
 * "로그인한 사용자 = 관리자"로 간주한다.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
