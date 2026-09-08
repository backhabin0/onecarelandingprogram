import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import {
  getGoogleSiteVerification,
  getNaverSiteVerification,
  getSiteMetadataBase,
} from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const googleSiteVerification = getGoogleSiteVerification();
const naverSiteVerification = getNaverSiteVerification();

export const metadata: Metadata = {
  metadataBase: getSiteMetadataBase(),
  title: "OneCare Admin",
  description: "랜딩페이지 자동 생성 및 배포 관리자 시스템",
  // 환경변수가 없으면 verification/other 자체를 생략한다(빈 content 생성 금지).
  ...(googleSiteVerification
    ? { verification: { google: googleSiteVerification } }
    : {}),
  ...(naverSiteVerification
    ? { other: { "naver-site-verification": naverSiteVerification } }
    : {}),
};

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
