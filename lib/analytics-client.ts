import type { LandingPageEventType } from "@/types/analytics";

/**
 * 브라우저에서 조회수/전화 클릭/카카오 클릭 이벤트를 서버로 전송한다.
 *
 * navigator.sendBeacon을 우선 사용해 tel:/카카오 링크 이동이나 페이지 언로드를
 * 절대 지연시키지 않는다. sendBeacon을 쓸 수 없는 환경에서는 keepalive fetch로
 * 대체하되, 실패해도 호출부(전화 걸기/카카오 이동/페이지 열람)는 항상 정상
 * 동작해야 하므로 에러를 조용히 무시한다.
 */
export function sendAnalyticsEvent(
  slug: string,
  eventType: LandingPageEventType
): void {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify({ slug, eventType });

  if (typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    const sent = navigator.sendBeacon("/api/analytics", blob);
    if (sent) return;
  }

  fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // 통계 전송 실패가 사용자 동작을 막아서는 안 된다.
  });
}
