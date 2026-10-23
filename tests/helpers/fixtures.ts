import { FakeSupabase } from "./fake-supabase";

/** 모든 시나리오에서 쓰는 데이터 크기: 0, 경계값 1,000, 1,200, 2,500 */
export const SIZES = [0, 1000, 1200, 2500] as const;

/**
 * 테스트 기준 "현재 시각". 한국시간 2026-10-15 12:00.
 * 통계 기간(이번 달)은 한국시간 2026-10-01 00:00 ~ 2026-11-01 00:00.
 */
export const NOW = new Date("2026-10-15T03:00:00.000Z");
const OCTOBER_START_KST_MS = Date.UTC(2026, 9, 1, -9); // 2026-10-01 00:00 KST
const SEPTEMBER_MID_MS = Date.UTC(2026, 8, 15);

const pad = (n: number) => String(n).padStart(5, "0");

/**
 * 7행씩 같은 created_at을 갖게 해서, 정렬 기준에 id tie-breaker가 없으면
 * 페이지 경계에서 행이 빠지거나 중복될 수 있는 상황을 만든다.
 */
function sharedTimestamp(i: number, baseMs: number, stepMs: number): string {
  return new Date(baseMs + Math.floor(i / 7) * stepMs).toISOString();
}

export interface Fixture {
  landingPages: Record<string, unknown>[];
  seoSettings: Record<string, unknown>[];
  consultations: Record<string, unknown>[];
  events: Record<string, unknown>[];
}

/**
 * 크기 n의 가짜 데이터.
 * - landing_pages: i % 4 === 0 이면 private, 나머지 public
 * - seo_settings: i % 5 === 0 인 페이지만 row가 있고, 그중 i % 10 === 0 이면 noindex
 * - consultations: 이번 달 안에 n건 + 지난달 3건(통계 기간 밖). landing_page_id는
 *   i % 11 === 0 이면 null(삭제된 랜딩페이지)
 * - events: 이번 달 안에 n건 + 지난달 3건. event_type은 page_view/phone_click/kakao_click 순환
 */
export function buildFixture(n: number): Fixture {
  const landingPages = Array.from({ length: n }, (_, i) => ({
    id: `lp-${pad(i)}`,
    business_name: `업체 ${i}`,
    title: `제목 ${i}`,
    slug: `shop-${pad(i)}`,
    hero_text: null,
    description: null,
    phone: null,
    kakao_url: null,
    address: null,
    logo_url: null,
    main_image_url: null,
    template: "template-a",
    status: i % 4 === 0 ? "private" : "public",
    created_at: sharedTimestamp(i, Date.UTC(2025, 0, 1), 60_000),
    updated_at: sharedTimestamp(i, Date.UTC(2025, 6, 1), 60_000),
  }));

  const seoSettings = landingPages
    .filter((_, i) => i % 5 === 0)
    .map((lp, k) => ({
      landing_page_id: lp.id,
      seo_noindex: (k * 5) % 10 === 0,
    }));

  const landingPageIdFor = (i: number) =>
    n === 0 || i % 11 === 0 ? null : `lp-${pad(i % n)}`;

  // 이번 달(10월, 31일) 안에 고르게 퍼지도록 간격을 잡는다.
  const stepMs = n > 0 ? Math.floor((31 * 24 * 60 * 60 * 1000) / Math.ceil(n / 7)) : 0;

  const consultations = [
    ...Array.from({ length: n }, (_, i) => ({
      id: `c-${pad(i)}`,
      landing_page_id: landingPageIdFor(i),
      name: i % 2 === 0 ? `홍길동${i}` : `김철수${i}`,
      phone: `010-0000-${String(i % 10000).padStart(4, "0")}`,
      message: i % 13 === 0 ? "=SUM(A1)" : `문의 ${i}`,
      privacy_consent: true,
      status: i % 3 === 0 ? "completed" : "new",
      submission_id: `sub-${pad(i)}`,
      created_at: sharedTimestamp(i, OCTOBER_START_KST_MS, stepMs),
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `c-old-${i}`,
      landing_page_id: null,
      name: `지난달${i}`,
      phone: "010-1111-1111",
      message: null,
      privacy_consent: true,
      status: "new",
      submission_id: `sub-old-${i}`,
      created_at: new Date(SEPTEMBER_MID_MS + i * 1000).toISOString(),
    })),
  ];

  const eventTypes = ["page_view", "phone_click", "kakao_click"] as const;
  const events = [
    ...Array.from({ length: n }, (_, i) => ({
      id: `e-${pad(i)}`,
      landing_page_id: landingPageIdFor(i),
      event_type: eventTypes[i % 3],
      created_at: sharedTimestamp(i, OCTOBER_START_KST_MS, stepMs),
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `e-old-${i}`,
      landing_page_id: null,
      event_type: "page_view",
      created_at: new Date(SEPTEMBER_MID_MS + i * 1000).toISOString(),
    })),
  ];

  return { landingPages, seoSettings, consultations, events };
}

export function createFakeSupabase(fixture: Fixture): FakeSupabase {
  return new FakeSupabase({
    tables: {
      landing_pages: fixture.landingPages,
      landing_page_seo_settings: fixture.seoSettings,
      landing_page_faqs: [],
      consultation_requests: fixture.consultations,
      landing_page_events: fixture.events,
    },
    relations: {
      landing_pages: {
        landing_page_seo_settings: { kind: "one", localKey: "id", foreignKey: "landing_page_id" },
        landing_page_faqs: { kind: "many", localKey: "id", foreignKey: "landing_page_id" },
      },
      consultation_requests: {
        landing_pages: { kind: "one", localKey: "landing_page_id", foreignKey: "id" },
      },
    },
  });
}
