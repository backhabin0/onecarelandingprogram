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
  submission_id: string | null;
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
  /**
   * 폼 세션마다 클라이언트가 생성하는 고유 식별자(crypto.randomUUID()).
   * 네트워크 재시도/중복 클릭으로 동일 요청이 두 번 도착해도 idempotency
   * 처리를 위해 사용한다(17단계, 010 migration의 UNIQUE 인덱스).
   */
  submissionId: string;
}

/** 검증을 마친 뒤 데이터 접근 레이어(lib/consultation-requests.ts)에 전달되는 입력값 */
export interface InsertConsultationRequestInput {
  landingPageId: string;
  name: string;
  phone: string;
  message: string | null;
  submissionId: string;
}

/** 목록/상세에서 함께 표시할 랜딩페이지 요약 정보. landing_page_id가 null이면 null. */
export interface ConsultationRequestLandingPageInfo {
  business_name: string;
  slug: string;
}

/** landing_pages와 JOIN한 상담 신청 row. 관리자 목록/상세 조회에서 사용한다. */
export interface ConsultationRequestWithLandingPage extends ConsultationRequest {
  landing_page: ConsultationRequestLandingPageInfo | null;
}

export type ConsultationRequestSort = "newest" | "oldest";

/** 관리자 상담 목록 조회 시 사용하는 검색/필터/정렬/페이지 조건 */
export interface ConsultationRequestFilters {
  search?: string;
  status?: ConsultationRequestStatus | "all";
  /** "all" | "deleted"(삭제된 랜딩페이지) | 실제 landing_pages.id */
  landingPageId?: string;
  sort?: ConsultationRequestSort;
  /** 1부터 시작. getAllConsultationRequestsForExport에서는 사용하지 않는다. */
  page?: number;
}
