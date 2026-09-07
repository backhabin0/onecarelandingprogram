/** landing_page_events.event_type로 저장 가능한 값. 상담 신청은 여기 포함하지 않는다. */
export type LandingPageEventType = "page_view" | "phone_click" | "kakao_click";

export type AnalyticsPeriod = "day" | "week" | "month";

/** 관리자 통계 화면의 검색 조건. landingPageId는 "all" | "deleted" | 실제 landing_pages.id */
export interface AnalyticsFilters {
  period: AnalyticsPeriod;
  landingPageId?: string;
}

/** 상단 요약 카드에 표시되는 4개 핵심 지표 */
export interface AnalyticsSummary {
  pageViews: number;
  phoneClicks: number;
  kakaoClicks: number;
  consultations: number;
}

/** 기간별 추이 그래프/표의 한 구간(시간대 또는 날짜) */
export interface AnalyticsTimeSeriesPoint {
  key: string;
  label: string;
  pageViews: number;
  phoneClicks: number;
  kakaoClicks: number;
  consultations: number;
}

/** 랜딩페이지별 성과 표의 한 행. landingPageId가 null이면 삭제된 랜딩페이지 */
export interface LandingPagePerformanceRow {
  landingPageId: string | null;
  businessName: string;
  slug: string | null;
  pageViews: number;
  phoneClicks: number;
  kakaoClicks: number;
  consultations: number;
}
