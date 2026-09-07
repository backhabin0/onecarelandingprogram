import type { NextRequest } from "next/server";
import { getPublicLandingPageBySlug } from "@/lib/landing-pages";
import { recordLandingPageEvent } from "@/lib/analytics";
import type { LandingPageEventType } from "@/types/analytics";

export const dynamic = "force-dynamic";

const ALLOWED_EVENT_TYPES: readonly LandingPageEventType[] = [
  "page_view",
  "phone_click",
  "kakao_click",
];

function isAllowedEventType(value: unknown): value is LandingPageEventType {
  return (
    typeof value === "string" &&
    (ALLOWED_EVENT_TYPES as readonly string[]).includes(value)
  );
}

const MAX_SLUG_LENGTH = 100;

/**
 * 공개 랜딩페이지에서 조회수/전화 클릭/카카오 클릭을 기록하는 공용 엔드포인트.
 *
 * 요청 본문의 slug만 신뢰의 출발점으로 삼고, 실제 landing_page id와 public
 * 여부는 여기서 다시 DB로 확인한다 — 클라이언트가 landing_page_id를 직접
 * 지정해 다른 페이지의 통계를 조작할 수 없다. 존재하지 않거나 private인
 * slug는 정보를 주지 않기 위해 조용히 무시한다(204).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return new Response(null, { status: 400 });
  }

  const { slug: rawSlug, eventType } = body as Record<string, unknown>;

  if (typeof rawSlug !== "string") {
    return new Response(null, { status: 400 });
  }

  const slug = rawSlug.trim().slice(0, MAX_SLUG_LENGTH);

  if (!slug || !isAllowedEventType(eventType)) {
    return new Response(null, { status: 400 });
  }

  const { data: landingPage } = await getPublicLandingPageBySlug(slug);

  if (!landingPage) {
    return new Response(null, { status: 204 });
  }

  await recordLandingPageEvent(landingPage.id, eventType);

  return new Response(null, { status: 204 });
}
