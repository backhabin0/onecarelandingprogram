/**
 * 사이트 기본 URL 및 검색엔진 소유권 확인 토큰을 한 곳에서 관리한다.
 * canonical / Open Graph URL / sitemap / robots가 모두 이 값을 기준으로
 * 생성되므로, 정식 도메인 연결 시 NEXT_PUBLIC_SITE_URL 하나만 바꾸면 된다.
 */

const DEFAULT_SITE_URL = "http://localhost:3000";

function normalizeSiteUrl(url: string): string {
  // 끝 슬래시를 제거해 getAbsoluteUrl에서 중복 슬래시가 생기지 않게 한다.
  return url.replace(/\/+$/, "");
}

/**
 * 사이트 기본 URL(끝에 "/" 없음)을 반환한다.
 *
 * NEXT_PUBLIC_SITE_URL이 없거나 올바른 URL 형식이 아니면 빌드/렌더링이
 * 실패하지 않도록 localhost로 안전하게 대체한다(로컬 개발 환경 기본값과 동일).
 */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;

  if (!raw) {
    return DEFAULT_SITE_URL;
  }

  try {
    return normalizeSiteUrl(new URL(raw).toString());
  } catch {
    console.error(
      `[site] NEXT_PUBLIC_SITE_URL 값이 올바른 URL이 아닙니다: "${raw}". 기본값(${DEFAULT_SITE_URL})을 사용합니다.`
    );
    return DEFAULT_SITE_URL;
  }
}

/** Next.js Metadata의 metadataBase에 사용할 URL 인스턴스. */
export function getSiteMetadataBase(): URL {
  return new URL(getSiteUrl());
}

/** path("/agym" 등)를 사이트 기본 URL과 합쳐 절대 URL로 만든다. */
export function getAbsoluteUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getSiteUrl()}${normalizedPath}`;
}

/**
 * Google Search Console 사이트 소유권 확인 토큰.
 * 설정되어 있지 않으면 undefined를 반환해 verification metadata 자체를 생략한다.
 */
export function getGoogleSiteVerification(): string | undefined {
  return process.env.GOOGLE_SITE_VERIFICATION || undefined;
}

/**
 * 네이버 서치어드바이저 사이트 소유권 확인 토큰.
 * 설정되어 있지 않으면 undefined를 반환해 meta 태그 자체를 생략한다.
 */
export function getNaverSiteVerification(): string | undefined {
  return process.env.NAVER_SITE_VERIFICATION || undefined;
}
