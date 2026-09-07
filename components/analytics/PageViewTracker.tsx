"use client";

import { useEffect, useRef } from "react";
import { sendAnalyticsEvent } from "@/lib/analytics-client";

interface PageViewTrackerProps {
  slug: string;
}

/**
 * 실제로 브라우저에 렌더링되었을 때만 page_view를 기록하기 위한 Client
 * Component. Server Component 렌더링만으로는 조회수를 올리지 않는다(빌드,
 * prefetch, 크롤러 등과 실제 방문을 구분하기 위함).
 *
 * sentRef는 React Strict Mode(dev)의 effect 이중 실행 때문에 하나의 로드에서
 * page_view가 2번 기록되지 않도록 막는다. 새로고침/새 방문은 컴포넌트가
 * 새로 mount되므로 정상적으로 새 조회로 기록된다.
 */
export default function PageViewTracker({ slug }: PageViewTrackerProps) {
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    sendAnalyticsEvent(slug, "page_view");
  }, [slug]);

  return null;
}
