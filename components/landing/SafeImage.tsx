"use client";

import { useState } from "react";

interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
}

/**
 * 공개 랜딩페이지의 logo/main image처럼, URL이 삭제/404/네트워크 오류로
 * 깨졌을 때 브라우저 기본 "깨진 이미지" 아이콘이 그대로 보이지 않게 한다.
 * 로드에 실패하면 이미지 자체를 렌더링하지 않는다(레이아웃은 호출부가 결정).
 */
export default function SafeImage({ src, alt, className }: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
  );
}
