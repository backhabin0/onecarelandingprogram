import "server-only";

import { getAbsoluteUrl } from "@/lib/site";

const RESEND_API_URL = "https://api.resend.com/emails";

export interface ConsultationNotificationInput {
  businessName: string;
  slug: string;
  name: string;
  phone: string;
  message: string | null;
  createdAt: Date;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatReceivedAt(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function buildEmailContent(input: ConsultationNotificationInput) {
  const pageUrl = getAbsoluteUrl(`/${input.slug}`);
  // 상담 id를 anon insert로는 안전하게 돌려받을 수 없어(RLS: anon은 SELECT
  // 정책이 없어 INSERT ... RETURNING이 실패한다) 상세 링크 대신 목록으로 안내한다.
  const adminUrl = getAbsoluteUrl("/admin/consultations");
  const receivedAt = formatReceivedAt(input.createdAt);
  const message = input.message?.trim() || "(내용 없음)";
  const phoneDigits = input.phone.replace(/\D/g, "");

  const subject = `[상담 접수] ${input.businessName} - ${input.name}`;

  const text = [
    "새로운 상담 신청이 접수되었습니다.",
    "",
    `업체: ${input.businessName}`,
    `페이지: ${pageUrl}`,
    `이름: ${input.name}`,
    `전화번호: ${input.phone}`,
    `문의: ${message}`,
    `접수시간: ${receivedAt}`,
    "",
    `관리자 상담관리: ${adminUrl}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="ko">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:24px 16px;">
      <h2 style="margin:0 0 16px;font-size:18px;color:#111;">새로운 상담 신청이 접수되었습니다</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#111;background:#fff;border-radius:8px;overflow:hidden;">
        <tbody>
          <tr>
            <td style="padding:10px 12px;color:#666;width:88px;border-bottom:1px solid #eee;">업체</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee;">${escapeHtml(input.businessName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;color:#666;border-bottom:1px solid #eee;">페이지</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee;"><a href="${escapeHtml(pageUrl)}" style="color:#2563eb;">${escapeHtml(pageUrl)}</a></td>
          </tr>
          <tr>
            <td style="padding:10px 12px;color:#666;border-bottom:1px solid #eee;">이름</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee;">${escapeHtml(input.name)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;color:#666;border-bottom:1px solid #eee;">전화번호</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee;"><a href="tel:${escapeHtml(phoneDigits)}" style="color:#2563eb;">${escapeHtml(input.phone)}</a></td>
          </tr>
          <tr>
            <td style="padding:10px 12px;color:#666;vertical-align:top;border-bottom:1px solid #eee;">문의</td>
            <td style="padding:10px 12px;white-space:pre-wrap;border-bottom:1px solid #eee;">${escapeHtml(message)}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;color:#666;">접수시간</td>
            <td style="padding:10px 12px;">${escapeHtml(receivedAt)}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin:20px 0 0;">
        <a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">
          관리자 상담관리 바로가기
        </a>
      </p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * 상담 신청이 DB에 저장된 뒤 관리자에게 보내는 이메일 알림.
 *
 * 이 함수는 절대 throw하지 않는다 — 환경변수 누락이나 Resend API 실패는
 * 내부에서 로그만 남기고 조용히 반환한다. 상담 저장(DB insert)은 이 함수와
 * 무관하게 이미 완료된 상태이며, 이메일은 부가 기능이다.
 */
export async function sendConsultationNotification(
  input: ConsultationNotificationInput
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONSULTATION_NOTIFICATION_EMAIL;
  const from = process.env.CONSULTATION_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    console.log(
      "consultation email notification skipped: configuration missing"
    );
    return;
  }

  try {
    const { subject, text, html } = buildEmailContent(input);

    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });

    if (!response.ok) {
      console.error(
        `[consultation-email] Resend API responded with status ${response.status}`
      );
      return;
    }

    console.log("consultation notification sent");
  } catch (err) {
    console.error(
      "[consultation-email] send failed:",
      err instanceof Error ? err.message : "unknown error"
    );
  }
}
