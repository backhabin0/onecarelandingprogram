/**
 * lib/landing-page-validation.ts 단위 테스트.
 *
 * - 규칙별 단건 검사(필수값, 글자 수, slug 규칙, 예약어, 카카오 URL, status, SEO, FAQ)
 * - 예전 코드(tests/helpers/legacy-landing-page-validation.ts)와 많은 입력 조합에서
 *   결과가 완전히 같은지 비교
 * - 대량 등록용 여러 행 검사(validateLandingPageRows)
 */
import { describe, expect, it } from "vitest";
import {
  FAQ_MAX_LENGTH,
  LANDING_PAGE_MAX_LENGTH,
  SEO_MAX_LENGTH,
  validateDuplicateLandingPageInput,
  validateFaqInput,
  validateLandingPageInput,
  validateLandingPageRows,
  validateSeoSettingsInput,
  type BulkLandingPageRowInput,
} from "@/lib/landing-page-validation";
import { RESERVED_SLUGS } from "@/lib/slug";
import type { CreateLandingPageInput } from "@/types/landing-page";
import type { UpdateSeoSettingsInput } from "@/types/seo";
import {
  legacyNormalizeAndValidate,
  legacyValidateFaqInput,
  legacyValidateSeoSettingsInput,
} from "./helpers/legacy-landing-page-validation";

const valid: CreateLandingPageInput = {
  businessName: "원케어 헬스",
  title: "원케어 PT",
  slug: "onecare-gym",
  heroText: "",
  description: "",
  phone: "",
  kakaoUrl: "",
  address: "",
  template: "template-a",
  status: "public",
};

const errorOf = (patch: Partial<CreateLandingPageInput>) =>
  validateLandingPageInput({ ...valid, ...patch }).error;

const REQUIRED = "업체명, 페이지 제목, URL Slug, 템플릿은 필수 입력값입니다.";
const SLUG_RULE =
  "URL Slug는 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다. 예: a-gym";
const KAKAO_SCHEME =
  "카카오톡 URL은 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다.";

describe("제한값", () => {
  it("기존 화면·action의 제한값 그대로다", () => {
    expect(LANDING_PAGE_MAX_LENGTH).toEqual({
      businessName: 100,
      title: 100,
      heroText: 200,
      description: 2000,
      phone: 30,
      address: 200,
      kakaoUrl: 500,
    });
    expect(SEO_MAX_LENGTH).toEqual({
      title: 120,
      description: 320,
      businessCategory: 100,
      serviceArea: 200,
    });
    expect(FAQ_MAX_LENGTH).toEqual({ question: 200, answer: 2000 });
  });
});

describe("필수값", () => {
  it.each(["businessName", "title", "slug", "template"] as const)("%s 누락", (field) => {
    expect(errorOf({ [field]: "" })).toBe(REQUIRED);
    expect(errorOf({ [field]: "   " })).toBe(REQUIRED);
  });

  it("선택 칸은 비어 있어도 통과", () => {
    expect(validateLandingPageInput(valid)).not.toHaveProperty("error");
  });
});

describe("정규화", () => {
  it("앞뒤 공백 제거, slug는 소문자로", () => {
    const { normalized, error } = validateLandingPageInput({
      ...valid,
      businessName: "  A  ",
      slug: "  My-Gym ",
      kakaoUrl: " https://open.kakao.com/o/x ",
    });
    expect(error).toBeUndefined();
    expect(normalized).toMatchObject({
      businessName: "A",
      slug: "my-gym",
      kakaoUrl: "https://open.kakao.com/o/x",
    });
    expect(normalized).not.toHaveProperty("status");
  });
});

describe("status", () => {
  it.each(["public", "private"])("%s 허용", (status) => {
    expect(errorOf({ status: status as never })).toBeUndefined();
  });
  it.each(["", "draft", "PUBLIC"])("%j 거부", (status) => {
    expect(errorOf({ status: status as never })).toBe("공개 상태 값이 올바르지 않습니다.");
  });
});

describe("slug 규칙", () => {
  it.each(["a", "a1", "a-gym", "gym-2024-seoul", "123"])("%s 허용", (slug) => {
    expect(errorOf({ slug })).toBeUndefined();
  });
  it.each(["a_gym", "a gym", "-a", "a-", "a--b", "헬스", "a.b", "a/b", "a%20b"])(
    "%s 거부",
    (slug) => {
      expect(errorOf({ slug })).toBe(SLUG_RULE);
    }
  );
});

describe("예약어", () => {
  const patternSafe = RESERVED_SLUGS.filter((slug) => /^[a-z0-9-]+$/.test(slug));
  const patternUnsafe = RESERVED_SLUGS.filter((slug) => !/^[a-z0-9-]+$/.test(slug));

  it.each(patternSafe)("%s → 사용할 수 없는 URL", (slug) => {
    expect(errorOf({ slug })).toBe("사용할 수 없는 URL입니다.");
    expect(errorOf({ slug: slug.toUpperCase() })).toBe("사용할 수 없는 URL입니다.");
  });

  it.each(patternUnsafe)("%s → slug 규칙에서 먼저 걸림", (slug) => {
    expect(errorOf({ slug })).toBe(SLUG_RULE);
  });

  it("예약어가 가운데·끝에 있으면 허용", () => {
    expect(errorOf({ slug: "my-admin-gym" })).toBeUndefined();
    expect(errorOf({ slug: "my-login" })).toBeUndefined();
    expect(errorOf({ slug: "rapid-api" })).toBeUndefined();
    expect(errorOf({ slug: "apartment-gym" })).toBeUndefined(); // "apa"는 "api"가 아님
  });

  it.each(["admin-gym", "administrator", "login-help", "loginx", "api-gym", "apink-xxx", "apiary", "ADMIN-GYM"])(
    "admin·login·api로 시작하는 %s → 사용할 수 없음(robots.txt 차단과 같은 규칙)",
    (slug) => {
      expect(errorOf({ slug })).toBe("admin, login, api로 시작하는 URL은 사용할 수 없습니다(검색엔진 차단 주소와 겹침).");
    }
  );
});

describe("글자 수", () => {
  const cases: [keyof typeof LANDING_PAGE_MAX_LENGTH, string][] = [
    ["businessName", "업체명은 100자 이내로 입력해주세요."],
    ["title", "페이지 제목은 100자 이내로 입력해주세요."],
    ["heroText", "대표 문구는 200자 이내로 입력해주세요."],
    ["description", "소개 문구는 2000자 이내로 입력해주세요."],
    ["phone", "전화번호는 30자 이내로 입력해주세요."],
    ["address", "주소는 200자 이내로 입력해주세요."],
  ];

  it.each(cases)("%s: 제한값까지 허용, 1자 넘으면 오류", (field, message) => {
    const max = LANDING_PAGE_MAX_LENGTH[field];
    expect(errorOf({ [field]: "가".repeat(max) })).toBeUndefined();
    expect(errorOf({ [field]: ` ${"가".repeat(max)} ` })).toBeUndefined();
    expect(errorOf({ [field]: "가".repeat(max + 1) })).toBe(message);
  });
});

describe("카카오톡 URL", () => {
  it.each([
    "https://open.kakao.com/o/abc",
    "http://pf.kakao.com/_abc",
    "https://example.com/chat",
  ])("%s 허용", (kakaoUrl) => {
    expect(errorOf({ kakaoUrl })).toBeUndefined();
  });

  it.each([
    "open.kakao.com/o/abc",
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://open.kakao.com",
    "카카오",
  ])("%s 거부", (kakaoUrl) => {
    expect(errorOf({ kakaoUrl })).toBe(KAKAO_SCHEME);
  });

  it("500자까지 허용, 넘으면 길이 오류가 스킴 오류보다 먼저", () => {
    const prefix = "https://open.kakao.com/";
    expect(errorOf({ kakaoUrl: prefix + "a".repeat(500 - prefix.length) })).toBeUndefined();
    expect(errorOf({ kakaoUrl: prefix + "a".repeat(501 - prefix.length) })).toBe(
      "카카오톡 URL은 500자 이내로 입력해주세요."
    );
    expect(errorOf({ kakaoUrl: "x".repeat(501) })).toBe(
      "카카오톡 URL은 500자 이내로 입력해주세요."
    );
  });
});

describe("복제 입력 검증", () => {
  it("업체명·제목·slug만 정규화해서 돌려준다", () => {
    expect(
      validateDuplicateLandingPageInput({
        businessName: " A ",
        title: " B ",
        slug: " Gym-Copy ",
        status: "private",
      })
    ).toEqual({ normalized: { businessName: "A", title: "B", slug: "gym-copy" } });
  });

  it("생성과 같은 규칙과 문구", () => {
    const base = { businessName: "A", title: "B", slug: "gym", status: "public" };
    expect(validateDuplicateLandingPageInput({ ...base, slug: "" }).error).toBe(REQUIRED);
    expect(validateDuplicateLandingPageInput({ ...base, slug: "a_b" }).error).toBe(SLUG_RULE);
    expect(validateDuplicateLandingPageInput({ ...base, slug: "admin" }).error).toBe(
      "사용할 수 없는 URL입니다."
    );
    expect(validateDuplicateLandingPageInput({ ...base, status: "x" }).error).toBe(
      "공개 상태 값이 올바르지 않습니다."
    );
  });
});

describe("SEO 설정 글자 수", () => {
  const empty: UpdateSeoSettingsInput = {
    seoTitle: "",
    seoDescription: "",
    ogTitle: "",
    ogDescription: "",
    businessCategory: "",
    serviceArea: "",
    seoNoindex: false,
    disableAutoFaq: false,
  };
  const cases: [keyof UpdateSeoSettingsInput, number, string][] = [
    ["seoTitle", 120, "SEO 제목은 120자 이내로 입력해주세요."],
    ["ogTitle", 120, "OG 제목은 120자 이내로 입력해주세요."],
    ["seoDescription", 320, "SEO 설명은 320자 이내로 입력해주세요."],
    ["ogDescription", 320, "OG 설명은 320자 이내로 입력해주세요."],
    ["businessCategory", 100, "업종/카테고리는 100자 이내로 입력해주세요."],
    ["serviceArea", 200, "서비스 지역은 200자 이내로 입력해주세요."],
  ];

  it.each(cases)("%s: %i자까지 허용", (field, max, message) => {
    expect(validateSeoSettingsInput({ ...empty, [field]: "가".repeat(max) })).toEqual({});
    expect(validateSeoSettingsInput({ ...empty, [field]: "가".repeat(max + 1) })).toEqual({
      error: message,
    });
  });
});

describe("FAQ 글자 수", () => {
  it("필수값과 제한값", () => {
    expect(validateFaqInput({ question: "q", answer: "a" })).toEqual({});
    expect(validateFaqInput({ question: " ", answer: "a" })).toEqual({
      error: "질문과 답변을 모두 입력해주세요.",
    });
    expect(validateFaqInput({ question: "가".repeat(200), answer: "가".repeat(2000) })).toEqual({});
    expect(validateFaqInput({ question: "가".repeat(201), answer: "a" })).toEqual({
      error: "질문은 200자 이내로 입력해주세요.",
    });
    expect(validateFaqInput({ question: "q", answer: "가".repeat(2001) })).toEqual({
      error: "답변은 2000자 이내로 입력해주세요.",
    });
  });
});

// ------------------------------------------------------------
// 예전 코드와 결과 비교(많은 입력 조합)
// ------------------------------------------------------------

describe("예전 검증 코드와 결과가 같다", () => {
  const variants: Record<keyof CreateLandingPageInput, string[]> = {
    businessName: ["원케어", "", "  ", "가".repeat(100), "가".repeat(101), ` ${"가".repeat(100)} `],
    title: ["PT", "", "가".repeat(101)],
    slug: ["gym", "", " Gym ", "a_b", "admin", "ADMIN", "sitemap.xml", "a--b", "-a", "my-admin-gym"],
    heroText: ["", "가".repeat(201)],
    description: ["", "가".repeat(2001)],
    phone: ["", "010", "0".repeat(31)],
    kakaoUrl: ["", " ", "https://open.kakao.com/o/x", "open.kakao.com", "javascript:x", `https://${"a".repeat(500)}`],
    address: ["", "가".repeat(201)],
    template: ["template-a", "", " template-b "],
    status: ["public", "private", "draft"],
  };

  // 기준 입력에서 한두 칸씩 바꾼 조합을 모두 만든다.
  const keys = Object.keys(variants) as (keyof CreateLandingPageInput)[];
  const inputs: CreateLandingPageInput[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (const a of variants[keys[i]]) {
      inputs.push({ ...valid, [keys[i]]: a });
      for (let j = i + 1; j < keys.length; j += 1) {
        for (const b of variants[keys[j]]) {
          inputs.push({ ...valid, [keys[i]]: a, [keys[j]]: b } as CreateLandingPageInput);
        }
      }
    }
  }

  it(`랜딩페이지 입력 ${inputs.length}가지 조합`, () => {
    expect(inputs.length).toBeGreaterThan(500);
    for (const input of inputs) {
      expect(validateLandingPageInput(input)).toEqual(legacyNormalizeAndValidate(input));
    }
  });

  it("SEO·FAQ 입력 조합", () => {
    const seoFields = ["seoTitle", "ogTitle", "seoDescription", "ogDescription", "businessCategory", "serviceArea"] as const;
    const lengths = [0, 100, 101, 120, 121, 200, 201, 320, 321];
    for (const a of seoFields) {
      for (const b of seoFields) {
        for (const la of lengths) {
          for (const lb of lengths) {
            const input: UpdateSeoSettingsInput = {
              seoTitle: "",
              seoDescription: "",
              ogTitle: "",
              ogDescription: "",
              businessCategory: "",
              serviceArea: "",
              seoNoindex: false,
              disableAutoFaq: false,
              [a]: "가".repeat(la),
              [b]: ` ${"나".repeat(lb)} `,
            };
            expect(validateSeoSettingsInput(input)).toEqual(legacyValidateSeoSettingsInput(input));
          }
        }
      }
    }

    for (const q of ["", " ", "q", "가".repeat(200), "가".repeat(201)]) {
      for (const a of ["", "a", "가".repeat(2000), "가".repeat(2001)]) {
        expect(validateFaqInput({ question: q, answer: a })).toEqual(
          legacyValidateFaqInput({ question: q, answer: a })
        );
      }
    }
  });
});

// ------------------------------------------------------------
// 대량 등록: 여러 행 한 번에 검사
// ------------------------------------------------------------

describe("validateLandingPageRows", () => {
  const row = (patch: BulkLandingPageRowInput = {}): BulkLandingPageRowInput => ({
    businessName: "원케어",
    title: "PT",
    slug: "gym",
    template: "template-a",
    status: "public",
    ...patch,
  });

  it("빈 목록", () => {
    expect(validateLandingPageRows([])).toEqual({
      rows: [],
      validCount: 0,
      errorCount: 0,
      warningCount: 0,
    });
  });

  it("행 번호는 firstRowNumber부터(CSV 머리글이면 2)", () => {
    const result = validateLandingPageRows([row({ slug: "a" }), row({ slug: "b" })], {
      firstRowNumber: 2,
    });
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(validateLandingPageRows([row()]).rows[0].rowNumber).toBe(1);
  });

  it("정상 행은 오류·경고 없음, 정규화 값 돌려줌", () => {
    const result = validateLandingPageRows([row({ businessName: " 원케어 ", status: " private " })]);
    expect(result.validCount).toBe(1);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].warnings).toEqual([]);
    expect(result.rows[0].normalized).toEqual({
      businessName: "원케어",
      title: "PT",
      slug: "gym",
      template: "template-a",
      heroText: "",
      description: "",
      phone: "",
      kakaoUrl: "",
      address: "",
      status: "private",
    });
  });

  it("한 행의 오류를 첫 번째에서 멈추지 않고 전부 모은다(단건과 같은 순서·문구)", () => {
    const input = row({
      businessName: "가".repeat(101),
      slug: "a_b",
      status: "draft",
      address: "가".repeat(201),
      kakaoUrl: "kakao",
    });
    const [result] = validateLandingPageRows([input]).rows;
    expect(result.errors.map((e) => e.message)).toEqual([
      "공개 상태 값이 올바르지 않습니다.",
      SLUG_RULE,
      "업체명은 100자 이내로 입력해주세요.",
      "주소는 200자 이내로 입력해주세요.",
      KAKAO_SCHEME,
    ]);
    // 첫 번째 오류 = 단건 검사 오류
    expect(result.errors[0].message).toBe(
      validateLandingPageInput({
        heroText: "",
        description: "",
        phone: "",
        ...input,
      } as CreateLandingPageInput).error
    );
  });

  it("빠진 칸(undefined)은 빈 값으로 보고 필수값 오류에 칸 이름을 담는다", () => {
    const [result] = validateLandingPageRows([{ slug: "gym" }]).rows;
    expect(result.errors).toEqual([
      { code: "required", fields: ["businessName", "title", "template"], message: REQUIRED },
      { code: "invalid_status", fields: ["status"], message: "공개 상태 값이 올바르지 않습니다." },
    ]);
  });

  it("빈 slug는 필수값 오류만(형식 오류 중복 없음)", () => {
    const [result] = validateLandingPageRows([row({ slug: "  " })]).rows;
    expect(result.errors.map((e) => e.code)).toEqual(["required"]);
  });

  it("예약어", () => {
    const [result] = validateLandingPageRows([row({ slug: "Admin" })]).rows;
    expect(result.errors).toEqual([
      { code: "reserved_slug", fields: ["slug"], message: "사용할 수 없는 URL입니다." },
    ]);
  });

  it("같은 묶음 안 slug 중복은 겹치는 모든 행에 오류(대소문자·공백 무시)", () => {
    const result = validateLandingPageRows(
      [row({ slug: "gym" }), row({ slug: "other" }), row({ slug: " GYM " }), row({ slug: "gym" })],
      { firstRowNumber: 2 }
    );
    const dupMessages = result.rows.map((r) =>
      r.errors.filter((e) => e.code === "duplicate_slug_in_batch").map((e) => e.message)
    );
    expect(dupMessages).toEqual([
      ["같은 URL Slug가 4, 5행에도 있습니다."],
      [],
      ["같은 URL Slug가 2, 5행에도 있습니다."],
      ["같은 URL Slug가 2, 4행에도 있습니다."],
    ]);
    expect(result.errorCount).toBe(3);
    expect(result.validCount).toBe(1);
  });

  it("형식이 틀린 slug끼리는 중복 오류를 따로 달지 않는다", () => {
    const result = validateLandingPageRows([row({ slug: "a_b" }), row({ slug: "a_b" })]);
    for (const r of result.rows) {
      expect(r.errors.map((e) => e.code)).toEqual(["invalid_slug"]);
    }
  });

  it("existingSlugs와 겹치면 '이미 사용 중인 URL'", () => {
    const result = validateLandingPageRows([row({ slug: "gym" }), row({ slug: "new-gym" })], {
      existingSlugs: ["GYM", "foo"],
    });
    expect(result.rows[0].errors).toEqual([
      { code: "slug_in_use", fields: ["slug"], message: "이미 사용 중인 URL입니다." },
    ]);
    expect(result.rows[1].errors).toEqual([]);
  });

  it("경고: slug 자동 변환, 카카오 외 도메인 — 등록은 가능", () => {
    const result = validateLandingPageRows([
      row({ slug: " My-Gym ", kakaoUrl: "https://example.com/chat" }),
      row({ slug: "b", kakaoUrl: "https://pf.kakao.com/_x" }),
    ]);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].warnings.map((w) => w.code)).toEqual(["slug_normalized", "non_kakao_url"]);
    expect(result.rows[0].warnings[0].message).toBe('URL Slug를 "my-gym"(으)로 바꿔서 저장합니다.');
    expect(result.rows[1].warnings).toEqual([]);
    expect(result).toMatchObject({ validCount: 2, errorCount: 0, warningCount: 1 });
  });

  it("잘못된 카카오 URL에는 경고 대신 오류만", () => {
    const [result] = validateLandingPageRows([row({ kakaoUrl: "kakao" })]).rows;
    expect(result.errors.map((e) => e.code)).toEqual(["invalid_url"]);
    expect(result.warnings).toEqual([]);
  });

  it("SEO 칸도 SEO 설정 화면과 같은 제한으로 검사", () => {
    const [result] = validateLandingPageRows([
      row({ seo: { seoTitle: "가".repeat(121), serviceArea: "가".repeat(200) } }),
    ]).rows;
    expect(result.errors).toEqual([
      { code: "too_long", fields: ["seoTitle"], message: "SEO 제목은 120자 이내로 입력해주세요." },
    ]);
  });

  it("1,200행도 행마다 결과가 나온다", () => {
    const rows = Array.from({ length: 1200 }, (_, i) =>
      row({ slug: i === 1199 ? "admin" : `gym-${i}` })
    );
    const result = validateLandingPageRows(rows, { firstRowNumber: 2 });
    expect(result.rows).toHaveLength(1200);
    expect(result.errorCount).toBe(1);
    expect(result.rows[1199]).toMatchObject({ rowNumber: 1201 });
    expect(result.rows[1199].errors[0].code).toBe("reserved_slug");
  });
});
