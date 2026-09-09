import type { NextConfig } from "next";

/**
 * 17단계: 기본 Production hardening 응답 헤더.
 * 현재 서비스가 실제로 쓰지 않는 브라우저 기능만 안전하게 제한한다.
 * Content-Security-Policy/HSTS는 이번 단계에서 적용하지 않는다 — inline
 * JSON-LD, Vercel, Next.js 내부 스크립트 등을 충분히 분석하지 않고 추가하면
 * 기존 기능이 깨질 수 있어, 제대로 설계(nonce/hash 포함)할 필요가 생기면
 * 별도 단계에서 다룬다.
 */
async function headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
  ];
}

const nextConfig: NextConfig = {
  headers,
};

export default nextConfig;
