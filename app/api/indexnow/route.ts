import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { submitPendingToIndexNow } from "@/lib/indexnow";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Authorization: Bearer <CRON_SECRET> 가 맞는지(길이가 달라도 시간 차이로 새지 않게 비교) */
function hasValidCronSecret(request: NextRequest): string | null {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 16) return null;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return null;
  return timingSafeEqual(actual, expected) ? secret : null;
}

/**
 * 아직 알리지 않은 공개 페이지를 IndexNow로 보낸다.
 * - 로그인한 관리자, 또는 Authorization: Bearer <CRON_SECRET> (예: Vercel Cron)만 호출 가능
 * - CRON_SECRET으로 부르면 DB에도 같은 값을 넘기며, DB는 Supabase Vault의
 *   'indexnow_cron_secret'과 비교해 확인한다(supabase/manual/015_cron_schedule.sql [B])
 * - 실패해도 공개된 페이지에는 영향이 없고, 다음 호출 때 다시 대상이 된다
 */
async function handle(request: NextRequest) {
  const secret = hasValidCronSecret(request);
  if (!secret) {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
  }

  const supabase = await getSupabaseServerClient();
  const result = await submitPendingToIndexNow({
    supabase,
    trigger: secret ? "cron" : "manual",
    secret,
  });

  const ok = result.status === "sent" || result.status === "nothing" || result.status === "not_configured";
  return NextResponse.json({ success: ok, ...result }, { status: ok ? 200 : 502 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
