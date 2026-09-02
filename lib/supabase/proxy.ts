import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

const PROTECTED_PREFIX = "/admin";

function isProtectedPath(pathname: string): boolean {
  return pathname === PROTECTED_PREFIX || pathname.startsWith(`${PROTECTED_PREFIX}/`);
}

/**
 * 모든 요청에서 Supabase 세션 쿠키를 갱신하고, /admin 이하 경로는
 * 로그인 세션이 없으면 /login으로 redirect한다.
 *
 * 이 함수가 /admin 보호의 1차 방어선이다 — 클라이언트 라우팅(Link 이동,
 * 프리페치)을 포함한 모든 요청이 여기를 거치므로, 레이아웃 캐싱 때문에
 * 인증 체크가 누락되는 상황을 막아준다. 2차 방어선은 app/admin/layout.tsx의
 * requireUser()이고, 실제 데이터 접근은 RLS(authenticated 정책)로 보호된다.
 */
export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request });

  if (!isProtectedPath(request.nextUrl.pathname)) {
    return supabaseResponse;
  }

  let supabaseUrl: string;
  let supabaseAnonKey: string;
  try {
    supabaseUrl = getSupabaseUrl();
    supabaseAnonKey = getSupabaseAnonKey();
  } catch (err) {
    // 환경변수가 설정되지 않은 경우 전체 사이트가 죽지 않도록 통과시킨다.
    // (이 경우 /admin 화면 자체도 Supabase 오류 배너를 보여주며 정상 동작하지 않는다.)
    console.error("[proxy] Supabase 환경변수가 설정되지 않아 인증 확인을 건너뜁니다:", err);
    return supabaseResponse;
  }

  let response = supabaseResponse;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser()/getClaims() 호출 사이에 다른 코드를 두지 않는다 — 세션이
  // 랜덤하게 끊기는 문제를 방지하기 위해 Supabase가 권장하는 방식이다.
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
