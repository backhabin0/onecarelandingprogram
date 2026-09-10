import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSiteMetadataBase } from "@/lib/site";
import { resolveSiteVerification } from "@/lib/site-verification";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 17.5단계: verification 값이 admin/settings에서 Redeploy 없이 즉시 반영돼야
 * 하므로 정적 metadata 객체 대신 매 요청 조회하는 generateMetadata를 사용한다.
 * resolveSiteVerification()이 DB(관리자 설정) 우선, 없으면 기존 환경변수
 * (GOOGLE_SITE_VERIFICATION / NAVER_SITE_VERIFICATION)로 안전하게 대체한다.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { google, naver } = await resolveSiteVerification();

  return {
    metadataBase: getSiteMetadataBase(),
    title: "OneCare Admin",
    description: "랜딩페이지 자동 생성 및 배포 관리자 시스템",
    // 값이 없으면 verification/other 자체를 생략한다(빈 content 생성 금지).
    ...(google ? { verification: { google } } : {}),
    ...(naver ? { other: { "naver-site-verification": naver } } : {}),
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
