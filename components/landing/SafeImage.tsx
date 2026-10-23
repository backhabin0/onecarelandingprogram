"use client";

import Image from "next/image";
import { useState } from "react";
import { isOptimizableImageUrl } from "@/lib/landing-images";

interface SafeImageProps {
  src: string;
  alt: string;
  /** <img>에 붙는 클래스(object-fit 등) */
  className?: string;
  /** 이미지를 감싸는 상자의 클래스. 크기와 position(relative/absolute)을 여기서 정한다. */
  wrapperClassName: string;
  /** 반응형 srcset 기준(next/image sizes) */
  sizes: string;
  /** 첫 화면의 큰 이미지(LCP)면 true — 먼저 내려받는다 */
  highPriority?: boolean;
}

/**
 * 공개 랜딩페이지 이미지(next/image, fill).
 * - Supabase Storage에 올린 이미지는 Next.js 이미지 최적화(크기별 srcset, WebP 등)를 거친다.
 *   엑셀로 받은 외부 사진 주소는 허용 목록에 없으므로 원본 그대로(unoptimized) 보여준다.
 * - 주소가 깨지면(삭제·404·네트워크 오류) 상자째 렌더링하지 않아 빈 칸이나 깨진 아이콘이 남지 않는다.
 */
export default function SafeImage({
  src,
  alt,
  className,
  wrapperClassName,
  sizes,
  highPriority = false,
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <div className={wrapperClassName}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className={className}
        unoptimized={!isOptimizableImageUrl(src)}
        fetchPriority={highPriority ? "high" : undefined}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
