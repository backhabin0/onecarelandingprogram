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

/**
 * 7단계: 공개 랜딩페이지 이미지(next/image) 최적화 허용 범위.
 * 이 프로젝트의 Supabase Storage 공개 경로만 허용한다(lib/landing-images.ts와 같은 기준).
 * 엑셀로 받은 그 밖의 외부 사진 주소는 컴포넌트에서 unoptimized로 원본을 보여준다.
 */
function supabaseImagePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  try {
    const { hostname } = new URL(raw);
    return [{ protocol: "https", hostname, pathname: "/storage/v1/object/public/**" }];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  headers,
  images: {
    remotePatterns: supabaseImagePatterns(),
    // 최적화 서버가 리다이렉트를 따라가 허용 목록 밖으로 나가지 않게 한다.
    maximumRedirects: 0,
  },
};

export default nextConfig;
