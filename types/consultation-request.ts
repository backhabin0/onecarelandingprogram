export type ConsultationRequestStatus =
  | "new"
  | "contacted"
  | "completed"
  | "cancelled";

/** consultation_requests 테이블 row와 1:1로 대응하는 타입 */
export interface ConsultationRequest {
  id: string;
  landing_page_id: string | null;
  name: string;
  phone: string;
  message: string | null;
  privacy_consent: boolean;
  status: ConsultationRequestStatus;
  created_at: string;
}

/** 상담 신청폼 → Server Action에 전달되는 입력값 */
export interface CreateConsultationRequestInput {
  slug: string;
  name: string;
  phone: string;
  message: string;
  privacyConsent: boolean;
  /** 스팸 방지용 honeypot 필드. 정상 사용자에게는 항상 빈 값이어야 한다. */
  website: string;
}

/** 검증을 마친 뒤 데이터 접근 레이어(lib/consultation-requests.ts)에 전달되는 입력값 */
export interface InsertConsultationRequestInput {
  landingPageId: string;
  name: string;
  phone: string;
  message: string | null;
}
