/**
 * 회귀 테스트: 생성·수정·복제(+SEO·FAQ) Server Action이 검증 규칙을
 * lib/landing-page-validation.ts로 옮긴 뒤에도 예전과 똑같은 결과를 내는지 확인한다.
 *
 * - DB 저장 함수(lib/landing-pages 등)는 spy로 바꿔서, 검증을 통과했을 때
 *   어떤 값이 저장 함수로 넘어가는지(정규화 결과)까지 비교한다.
 * - 기대값은 리팩터링 전 코드로 먼저 돌려서 통과를 확인한 값이다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateLandingPageInput } from "@/types/landing-page";
import type { UpdateSeoSettingsInput } from "@/types/seo";

const mocks = vi.hoisted(() => ({
  insertLandingPage: vi.fn(async () => ({ success: true, id: "new-id" })),
  updateLandingPage: vi.fn(async () => ({ success: true })),
  duplicateLandingPage: vi.fn(async () => ({ success: true, id: "dup-id" })),
  upsertSeoSettings: vi.fn(async () => ({ success: true })),
  createFaq: vi.fn(async () => ({ success: true, id: "faq-id" })),
  updateFaq: vi.fn(async () => ({ success: true, id: "faq-id" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/landing-pages", () => ({
  insertLandingPage: mocks.insertLandingPage,
  updateLandingPage: mocks.updateLandingPage,
  duplicateLandingPage: mocks.duplicateLandingPage,
  deleteLandingPage: vi.fn(),
  updateLandingPageImageUrl: vi.fn(),
  updateLandingPageStatus: vi.fn(),
}));
vi.mock("@/lib/seo-settings", () => ({
  upsertSeoSettings: mocks.upsertSeoSettings,
  resetSeoOverrides: vi.fn(),
  updateSeoOgImageUrl: vi.fn(),
}));
vi.mock("@/lib/faqs", () => ({
  createFaq: mocks.createFaq,
  updateFaq: mocks.updateFaq,
  deleteFaq: vi.fn(),
  moveFaq: vi.fn(),
}));

const {
  createLandingPageAction,
  updateLandingPageAction,
  duplicateLandingPageAction,
  updateSeoSettingsAction,
  createFaqAction,
  updateFaqAction,
} = await import("@/app/admin/pages/actions");

const REQUIRED = "업체명, 페이지 제목, URL Slug, 템플릿은 필수 입력값입니다.";
const SLUG_RULE =
  "URL Slug는 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다. 예: a-gym";

const base: CreateLandingPageInput = {
  businessName: "  원케어 헬스  ",
  title: " 원케어 PT ",
  slug: "  OneCare-Gym ",
  heroText: " 첫 상담 무료 ",
  description: " 소개 ",
  phone: " 010-1234-5678 ",
  kakaoUrl: " https://open.kakao.com/o/abc ",
  address: " 서울 ",
  template: " template-a ",
  status: "public",
};

const longText = (n: number) => "가".repeat(n);

/** [설명, 입력 변경, 기대 오류(null이면 통과)] */
const PAGE_CASES: [string, Partial<CreateLandingPageInput>, string | null][] = [
  ["정상 입력", {}, null],
  ["업체명 누락(공백만)", { businessName: "   " }, REQUIRED],
  ["제목 누락", { title: "" }, REQUIRED],
  ["slug 누락", { slug: " " }, REQUIRED],
  ["템플릿 누락", { template: "" }, REQUIRED],
  ["필수값 누락이 slug 규칙보다 먼저", { businessName: "", slug: "한글" }, REQUIRED],
  ["잘못된 status", { status: "draft" as never }, "공개 상태 값이 올바르지 않습니다."],
  ["status 오류가 slug 규칙보다 먼저", { status: "x" as never, slug: "a_b" }, "공개 상태 값이 올바르지 않습니다."],
  ["slug 밑줄", { slug: "a_gym" }, SLUG_RULE],
  ["slug 한글", { slug: "헬스장" }, SLUG_RULE],
  ["slug 하이픈 시작", { slug: "-gym" }, SLUG_RULE],
  ["slug 하이픈 끝", { slug: "gym-" }, SLUG_RULE],
  ["slug 연속 하이픈", { slug: "a--gym" }, SLUG_RULE],
  ["slug 가운데 공백", { slug: "a gym" }, SLUG_RULE],
  ["slug 점(예약어 sitemap.xml도 패턴에서 먼저 걸림)", { slug: "sitemap.xml" }, SLUG_RULE],
  ["예약어 admin", { slug: "admin" }, "사용할 수 없는 URL입니다."],
  ["예약어 대문자 API", { slug: " API " }, "사용할 수 없는 URL입니다."],
  ["예약어 login", { slug: "login" }, "사용할 수 없는 URL입니다."],
  ["admin으로 시작(admin-gym)", { slug: "admin-gym" }, "admin, login, api로 시작하는 URL은 사용할 수 없습니다(검색엔진 차단 주소와 겹침)."],
  ["api로 시작(apink-gym, 대문자)", { slug: " APINK-GYM " }, "admin, login, api로 시작하는 URL은 사용할 수 없습니다(검색엔진 차단 주소와 겹침)."],
  ["예약어가 가운데 있으면 허용(my-admin-gym)", { slug: "my-admin-gym" }, null],
  ["업체명 100자는 허용", { businessName: longText(100) }, null],
  ["업체명 101자", { businessName: longText(101) }, "업체명은 100자 이내로 입력해주세요."],
  ["업체명 앞뒤 공백은 길이에서 제외", { businessName: ` ${longText(100)} ` }, null],
  ["제목 101자", { title: longText(101) }, "페이지 제목은 100자 이내로 입력해주세요."],
  ["대표 문구 201자", { heroText: longText(201) }, "대표 문구는 200자 이내로 입력해주세요."],
  ["소개 2001자", { description: longText(2001) }, "소개 문구는 2000자 이내로 입력해주세요."],
  ["소개 2000자는 허용", { description: longText(2000) }, null],
  ["전화 31자", { phone: "0".repeat(31) }, "전화번호는 30자 이내로 입력해주세요."],
  ["주소 201자", { address: longText(201) }, "주소는 200자 이내로 입력해주세요."],
  ["여러 글자 수 초과면 업체명 오류가 먼저", { businessName: longText(101), address: longText(201) }, "업체명은 100자 이내로 입력해주세요."],
  ["카카오 URL 비어 있음은 허용", { kakaoUrl: "  " }, null],
  ["카카오 URL 501자", { kakaoUrl: `https://open.kakao.com/${"a".repeat(478)}` }, "카카오톡 URL은 500자 이내로 입력해주세요."],
  ["카카오 URL 스킴 없음", { kakaoUrl: "open.kakao.com/o/abc" }, "카카오톡 URL은 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다."],
  ["카카오 URL javascript:", { kakaoUrl: "javascript:alert(1)" }, "카카오톡 URL은 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다."],
  ["카카오 URL http는 허용", { kakaoUrl: "http://pf.kakao.com/_abc" }, null],
  ["카카오 외 도메인도 허용(호스트 강제 안 함)", { kakaoUrl: "https://example.com/chat" }, null],
];

const expectedNormalized = (input: CreateLandingPageInput) => ({
  ...input,
  businessName: input.businessName.trim(),
  title: input.title.trim(),
  slug: input.slug.trim().toLowerCase(),
  template: input.template.trim(),
  heroText: input.heroText.trim(),
  description: input.description.trim(),
  phone: input.phone.trim(),
  kakaoUrl: input.kakaoUrl.trim(),
  address: input.address.trim(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("생성 action 회귀", () => {
  it.each(PAGE_CASES)("%s", async (_name, patch, expectedError) => {
    const input = { ...base, ...patch };
    const result = await createLandingPageAction(input);

    if (expectedError) {
      expect(result).toEqual({ success: false, error: expectedError });
      expect(mocks.insertLandingPage).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ success: true, id: "new-id" });
      expect(mocks.insertLandingPage).toHaveBeenCalledWith(expectedNormalized(input));
    }
  });
});

describe("수정 action 회귀", () => {
  it.each(PAGE_CASES)("%s", async (_name, patch, expectedError) => {
    const input = { ...base, ...patch };
    const result = await updateLandingPageAction("page-1", input);

    if (expectedError) {
      expect(result).toEqual({ success: false, error: expectedError });
      expect(mocks.updateLandingPage).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ success: true });
      expect(mocks.updateLandingPage).toHaveBeenCalledWith("page-1", expectedNormalized(input));
    }
  });

  it("id가 없으면 검증 전에 잘못된 요청", async () => {
    const result = await updateLandingPageAction("", { ...base, businessName: "" });
    expect(result).toEqual({ success: false, error: "잘못된 요청입니다." });
  });
});

/** 복제는 업체명·제목·slug·status만 받는다. 나머지 필드는 검사 대상이 아님 */
const DUPLICATE_CASES: [string, { businessName: string; title: string; slug: string; status: string }, string | null][] = [
  ["정상", { businessName: " 원케어 ", title: " PT ", slug: " Gym-Copy ", status: "public" }, null],
  ["업체명 누락", { businessName: " ", title: "PT", slug: "gym-copy", status: "public" }, REQUIRED],
  ["slug 누락", { businessName: "a", title: "PT", slug: "", status: "private" }, REQUIRED],
  ["잘못된 status", { businessName: "a", title: "PT", slug: "gym", status: "hidden" }, "공개 상태 값이 올바르지 않습니다."],
  ["slug 규칙 위반", { businessName: "a", title: "PT", slug: "gym copy", status: "public" }, SLUG_RULE],
  ["예약어", { businessName: "a", title: "PT", slug: "robots.txt", status: "public" }, SLUG_RULE],
  ["예약어 api", { businessName: "a", title: "PT", slug: "api", status: "public" }, "사용할 수 없는 URL입니다."],
  ["login으로 시작(login-gym-copy)", { businessName: "a", title: "PT", slug: "login-gym-copy", status: "public" }, "admin, login, api로 시작하는 URL은 사용할 수 없습니다(검색엔진 차단 주소와 겹침)."],
  ["업체명 101자", { businessName: longText(101), title: "PT", slug: "gym", status: "public" }, "업체명은 100자 이내로 입력해주세요."],
  ["제목 101자", { businessName: "a", title: longText(101), slug: "gym", status: "public" }, "페이지 제목은 100자 이내로 입력해주세요."],
];

describe("복제 action 회귀", () => {
  it.each(DUPLICATE_CASES)("%s", async (_name, input, expectedError) => {
    const result = await duplicateLandingPageAction("source-1", input as never);

    if (expectedError) {
      expect(result).toEqual({ success: false, error: expectedError });
      expect(mocks.duplicateLandingPage).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ success: true, id: "dup-id" });
      expect(mocks.duplicateLandingPage).toHaveBeenCalledWith("source-1", {
        businessName: input.businessName.trim(),
        title: input.title.trim(),
        slug: input.slug.trim().toLowerCase(),
        status: input.status,
      });
    }
  });

  it("원본 id가 없으면 잘못된 요청", async () => {
    const result = await duplicateLandingPageAction("", {
      businessName: "a",
      title: "b",
      slug: "c",
      status: "public",
    });
    expect(result).toEqual({ success: false, error: "잘못된 요청입니다." });
  });
});

const seoBase: UpdateSeoSettingsInput = {
  seoTitle: "",
  seoDescription: "",
  ogTitle: "",
  ogDescription: "",
  businessCategory: "",
  serviceArea: "",
  seoNoindex: false,
  disableAutoFaq: false,
};

const SEO_CASES: [string, Partial<UpdateSeoSettingsInput>, string | null][] = [
  ["모두 비어 있음", {}, null],
  ["SEO 제목 120자는 허용", { seoTitle: longText(120) }, null],
  ["SEO 제목 121자", { seoTitle: longText(121) }, "SEO 제목은 120자 이내로 입력해주세요."],
  ["OG 제목 121자", { ogTitle: longText(121) }, "OG 제목은 120자 이내로 입력해주세요."],
  ["SEO 설명 321자", { seoDescription: longText(321) }, "SEO 설명은 320자 이내로 입력해주세요."],
  ["OG 설명 321자", { ogDescription: longText(321) }, "OG 설명은 320자 이내로 입력해주세요."],
  ["업종 101자", { businessCategory: longText(101) }, "업종/카테고리는 100자 이내로 입력해주세요."],
  ["서비스 지역 201자", { serviceArea: longText(201) }, "서비스 지역은 200자 이내로 입력해주세요."],
  ["앞뒤 공백은 길이에서 제외", { seoTitle: `  ${longText(120)}  ` }, null],
  ["여러 개 초과면 SEO 제목 오류가 먼저", { serviceArea: longText(201), seoTitle: longText(121) }, "SEO 제목은 120자 이내로 입력해주세요."],
];

describe("SEO 설정 action 회귀", () => {
  it.each(SEO_CASES)("%s", async (_name, patch, expectedError) => {
    const input = { ...seoBase, ...patch };
    const result = await updateSeoSettingsAction("page-1", "gym", input);

    if (expectedError) {
      expect(result).toEqual({ success: false, error: expectedError });
      expect(mocks.upsertSeoSettings).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ success: true });
      // SEO 입력은 정규화하지 않고 원본 그대로 저장 함수에 넘긴다(기존 동작).
      expect(mocks.upsertSeoSettings).toHaveBeenCalledWith("page-1", input);
    }
  });
});

const FAQ_CASES: [string, { question: string; answer: string }, string | null][] = [
  ["정상", { question: " 주차 되나요? ", answer: " 네 " }, null],
  ["질문 누락", { question: "  ", answer: "네" }, "질문과 답변을 모두 입력해주세요."],
  ["답변 누락", { question: "질문", answer: "" }, "질문과 답변을 모두 입력해주세요."],
  ["질문 200자는 허용", { question: longText(200), answer: "네" }, null],
  ["질문 201자", { question: longText(201), answer: "네" }, "질문은 200자 이내로 입력해주세요."],
  ["답변 2001자", { question: "질문", answer: longText(2001) }, "답변은 2000자 이내로 입력해주세요."],
];

describe("FAQ action 회귀", () => {
  it.each(FAQ_CASES)("생성: %s", async (_name, input, expectedError) => {
    const result = await createFaqAction("page-1", "gym", input);
    if (expectedError) {
      expect(result).toEqual({ success: false, error: expectedError });
      expect(mocks.createFaq).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ success: true, id: "faq-id" });
      expect(mocks.createFaq).toHaveBeenCalledWith("page-1", {
        question: input.question.trim(),
        answer: input.answer.trim(),
      });
    }
  });

  it.each(FAQ_CASES)("수정: %s", async (_name, input, expectedError) => {
    const result = await updateFaqAction("faq-1", "page-1", "gym", { ...input, isActive: false });
    if (expectedError) {
      expect(result).toEqual({ success: false, error: expectedError });
      expect(mocks.updateFaq).not.toHaveBeenCalled();
    } else {
      expect(result).toEqual({ success: true, id: "faq-id" });
      expect(mocks.updateFaq).toHaveBeenCalledWith("faq-1", {
        question: input.question.trim(),
        answer: input.answer.trim(),
        isActive: false,
      });
    }
  });
});
