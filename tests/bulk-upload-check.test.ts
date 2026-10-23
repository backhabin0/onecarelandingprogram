/**
 * 대량 등록 행 검사(checkBulkUploadRows)와 요청 나누기(payload).
 */
import { describe, expect, it } from "vitest";
import {
  buildUploadSlug,
  checkBulkUploadRows,
  decideQueueState,
  issuesForStorage,
  type BulkCheckContext,
} from "@/lib/bulk-upload/check";
import type { UploadRow, UploadValues } from "@/lib/bulk-upload/parse";
import {
  chunkRowsBySize,
  sanitizeStringList,
  sanitizeUploadPayload,
  toPayload,
} from "@/lib/bulk-upload/payload";
import { similarityText } from "@/lib/bulk-upload/similarity";

const LONG_TEXT =
  "역에서 3분 거리에 있는 헬스장입니다. 10년째 운영하며 체형 분석 후 개인별 운동 계획을 세워 드립니다. 첫 상담은 무료입니다.";

function values(i: number, patch: UploadValues = {}): UploadValues {
  return {
    region: `지역${i}`,
    keyword: "헬스장",
    regionSlug: `region-${i}`,
    keywordSlug: "gym",
    businessName: `업체 ${i}`,
    title: `지역${i} 헬스장`,
    // 행마다 전혀 다른 문구(유사도 0)
    heroText: `고유문구${i}`.repeat(1),
    description: `설명-${i}-${"가나다라마바사아자차카타파하".slice(i % 10)}`,
    ...patch,
  };
}

const row = (rowNumber: number, v: UploadValues): UploadRow => ({ rowNumber, values: v, warnings: [] });

const ctx = (patch: Partial<BulkCheckContext> = {}): BulkCheckContext => ({
  existingSlugs: [],
  existingPairs: [],
  corpus: [],
  thresholds: { warning: 0.6, error: 0.8 },
  ...patch,
});

describe("slug 자동 생성", () => {
  it("비어 있으면 {region_slug}-{keyword_slug}(소문자), 있으면 그대로", () => {
    expect(buildUploadSlug({ regionSlug: " Gangnam ", keywordSlug: "GYM" })).toBe("gangnam-gym");
    expect(buildUploadSlug({ regionSlug: "a", keywordSlug: "b", slug: " custom-url " })).toBe("custom-url");
    expect(buildUploadSlug({ regionSlug: "a" })).toBe("");
  });
});

describe("행 검사", () => {
  it("정상 행은 통과하고, 저장할 값이 정리된다", () => {
    const result = checkBulkUploadRows(
      [
        row(2, values(0, {
          phone: " 010-1111-2222 ",
          faqQuestion1: "주차 되나요?",
          faqAnswer1: "네",
          faqQuestion3: "가격은?",
          faqAnswer3: "상담 후 안내",
          seoTitle: "SEO",
        })),
      ],
      ctx()
    );
    expect(result).toMatchObject({ passCount: 1, warningCount: 0, errorCount: 0 });
    expect(result.rows[0].queueRow).toEqual({
      region: "지역0",
      keyword: "헬스장",
      region_slug: "region-0",
      keyword_slug: "gym",
      business_name: "업체 0",
      title: "지역0 헬스장",
      slug: "region-0-gym",
      hero_text: "고유문구0",
      description: expect.any(String),
      phone: "010-1111-2222",
      kakao_url: null,
      address: null,
      template: "template-a",
      seo_title: "SEO",
      seo_description: null,
      faqs: [
        { question: "주차 되나요?", answer: "네" },
        { question: "가격은?", answer: "상담 후 안내" },
      ],
      max_similarity: null,
    });
    expect(decideQueueState(result.rows[0], false)).toBe("ready");
  });

  it("기존 규칙(필수값·글자 수·slug·예약어·카카오 URL)을 그대로 쓴다", () => {
    const result = checkBulkUploadRows(
      [
        row(2, values(0, { businessName: "" })),
        row(3, values(1, { title: "가".repeat(101) })),
        row(4, values(2, { regionSlug: "강남" })),
        row(5, values(3, { slug: "admin" })),
        row(6, values(4, { kakaoUrl: "open.kakao.com/o/x" })),
      ],
      ctx()
    );
    const messages = result.rows.map((r) => r.errors.map((e) => e.message));
    expect(messages[0]).toContain("업체명, 페이지 제목, URL Slug, 템플릿은 필수 입력값입니다.");
    expect(messages[1]).toContain("페이지 제목은 100자 이내로 입력해주세요.");
    expect(messages[2]).toContain("region_slug는 영문 소문자, 숫자, 하이픈(-)만 사용할 수 있습니다.");
    expect(messages[3]).toContain("사용할 수 없는 URL입니다.");
    expect(messages[4]).toContain(
      "카카오톡 URL은 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다."
    );
    expect(result.errorCount).toBe(5);
    for (const r of result.rows) expect(decideQueueState(r, true)).toBeNull();
  });

  it("지역·키워드·region_slug·keyword_slug 필수", () => {
    const [r] = checkBulkUploadRows([row(2, values(0, { region: "", keywordSlug: "" }))], ctx()).rows;
    expect(r.errors[0]).toEqual({
      code: "required",
      fields: ["region", "keywordSlug"],
      message: "지역, 키워드, region_slug, keyword_slug는 필수 입력값입니다.",
    });
  });

  it("템플릿: 비면 template-a, 모르는 값은 오류", () => {
    const result = checkBulkUploadRows(
      [row(2, values(0, { template: "" })), row(3, values(1, { template: "template-z" }))],
      ctx()
    );
    expect(result.rows[0].queueRow.template).toBe("template-a");
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[1].errors.map((e) => e.code)).toEqual(["unknown_template"]);
  });

  it("FAQ: 질문·답변 짝, 글자 수", () => {
    const result = checkBulkUploadRows(
      [
        row(2, values(0, { faqQuestion2: "질문만" })),
        row(3, values(1, { faqQuestion1: "가".repeat(201), faqAnswer1: "답" })),
      ],
      ctx()
    );
    expect(result.rows[0].errors.map((e) => e.message)).toEqual(["FAQ 2: 질문과 답변을 모두 입력해주세요."]);
    expect(result.rows[1].errors.map((e) => e.message)).toEqual(["FAQ 1: 질문은 200자 이내로 입력해주세요."]);
  });

  it("같은 파일 안 slug·지역키워드 중복, 이미 쓰는 slug, 대기열의 지역·키워드", () => {
    const result = checkBulkUploadRows(
      [
        row(2, values(0)),
        row(3, values(1, { region: "지역0", regionSlug: "region-0" })), // 0과 slug·지역키워드 모두 겹침
        row(4, values(2)), // existingSlugs
        row(7, values(3)), // existingPairs
      ],
      ctx({
        existingSlugs: ["region-2-gym"],
        existingPairs: [{ region: "지역3", keyword: "헬스장" }],
      })
    );
    const codes = result.rows.map((r) => r.errors.map((e) => e.code).sort());
    expect(codes[0]).toEqual(["duplicate_pair_in_batch", "duplicate_slug_in_batch"]);
    expect(codes[1]).toEqual(["duplicate_pair_in_batch", "duplicate_slug_in_batch"]);
    expect(codes[2]).toEqual(["slug_in_use"]);
    expect(codes[3]).toEqual(["pair_in_queue"]);
    expect(result.rows[0].errors.find((e) => e.code === "duplicate_pair_in_batch")?.message).toBe(
      "같은 지역·키워드가 3행에도 있습니다."
    );
  });

  it("파싱 경고(숫자 전화번호)와 slug 자동 변환 경고는 경고로 남고 저장은 된다", () => {
    const [r] = checkBulkUploadRows(
      [
        {
          rowNumber: 2,
          values: values(0, { slug: "My-Url" }),
          warnings: [{ code: "phone_number_cell", fields: ["phone"], message: "숫자 전화번호" }],
        },
      ],
      ctx()
    ).rows;
    expect(r.status).toBe("warning");
    expect(r.warnings.map((w) => w.code)).toEqual(["phone_number_cell", "slug_normalized"]);
    expect(r.queueRow.slug).toBe("my-url");
    expect(decideQueueState(r, false)).toBe("ready");
  });
});

describe("문장 유사도 검사", () => {
  const similar = (region: string) => ({ heroText: `${region} 헬스장`, description: LONG_TEXT });

  it("같은 키워드의 기존 문구와 비교: 0.6 이상 경고, 0.8 이상 오류(hold 가능)", () => {
    const corpus = [
      { keyword: "헬스장", text: similarityText("강남 헬스장", LONG_TEXT), label: "기존 페이지 /gangnam-gym" },
    ];
    // 한 구절만 바꾼 문구(유사도 약 0.65)
    const almost = LONG_TEXT.replace("10년째 운영하며", "새로 문을 열어");
    const result = checkBulkUploadRows(
      [row(2, values(0, similar("서초"))), row(3, values(1, { heroText: "서초 헬스장", description: almost }))],
      ctx({ corpus })
    );

    const [high, mid] = result.rows;
    expect(high.similarity?.label).toBe("기존 페이지 /gangnam-gym");
    expect(high.similarity!.score).toBeGreaterThanOrEqual(0.8);
    expect(high.errors.map((e) => e.code)).toEqual(["similarity_too_high"]);
    expect(high.holdable).toBe(true);
    expect(decideQueueState(high, false)).toBeNull();
    expect(decideQueueState(high, true)).toBe("hold");
    expect(high.queueRow.max_similarity).toBe(high.similarity!.score);

    expect(mid.similarity!.score).toBeGreaterThanOrEqual(0.6);
    expect(mid.similarity!.score).toBeLessThan(0.8);
    expect(mid.status).toBe("warning");
    expect(mid.warnings.map((w) => w.code)).toEqual(["similarity_high"]);
    expect(decideQueueState(mid, false)).toBe("ready");
  });

  it("다른 키워드의 문구와는 비교하지 않는다", () => {
    const corpus = [{ keyword: "필라테스", text: similarityText("강남 헬스장", LONG_TEXT), label: "x" }];
    const [r] = checkBulkUploadRows([row(2, values(0, similar("서초")))], ctx({ corpus })).rows;
    expect(r.similarity).toBeNull();
    expect(r.status).toBe("pass");
  });

  it("파일 안에서는 앞 행과만 비교한다(첫 행은 통과, 뒤 행이 오류)", () => {
    const result = checkBulkUploadRows(
      [row(2, values(0, similar("강남"))), row(3, values(1, similar("서초"))), row(4, values(2, similar("송파")))],
      ctx()
    );
    expect(result.rows[0].status).toBe("pass");
    expect(result.rows[1].similarity?.label).toBe("2행");
    expect(result.rows[1].holdable).toBe(true);
    // 3행(오류)도 유사도 외 오류가 없으므로 비교 대상에 들어가지만, 동점이면 먼저 넣은 2행
    expect(result.rows[2].similarity?.label).toBe("2행");
  });

  it("유사도 외 오류가 있는 앞 행은 비교 대상에서 빠진다(저장되지 않을 행이므로)", () => {
    const result = checkBulkUploadRows(
      [row(2, values(0, { ...similar("강남"), businessName: "" })), row(3, values(1, similar("서초")))],
      ctx()
    );
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[1].similarity).toBeNull();
    expect(result.rows[1].status).toBe("pass");
  });

  it("다른 오류도 있으면 hold로도 저장하지 않는다", () => {
    const [, r] = checkBulkUploadRows(
      [row(2, values(0, similar("강남"))), row(3, values(1, { ...similar("서초"), phone: "0".repeat(31) }))],
      ctx()
    ).rows;
    expect(r.errors.map((e) => e.code).sort()).toEqual(["similarity_too_high", "too_long"]);
    expect(r.holdable).toBe(false);
    expect(decideQueueState(r, true)).toBeNull();
  });

  it("기준값을 바꾸면 결과가 바뀐다", () => {
    const rows = [row(2, values(0, similar("강남"))), row(3, values(1, similar("서초")))];
    const strict = checkBulkUploadRows(rows, ctx({ thresholds: { warning: 0.99, error: 1 } }));
    expect(strict.rows[1].status).toBe("pass");
  });

  it("저장용 issues에는 level이 붙는다", () => {
    const [, r] = checkBulkUploadRows(
      [row(2, values(0, similar("강남"))), row(3, values(1, { ...similar("서초"), slug: "Upper" }))],
      ctx()
    ).rows;
    expect(issuesForStorage(r).map((i) => [i.code, i.level])).toEqual([
      ["similarity_too_high", "error"],
      ["slug_normalized", "warning"],
    ]);
  });
});

describe("요청 나누기와 서버 입력 확인", () => {
  it("크기·행 수 제한으로 나누고 순서를 유지한다", () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({ rowNumber: i + 2, values: values(i) }));
    const byCount = chunkRowsBySize(rows, 10_000_000, 200);
    expect(byCount.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(byCount.flat()).toEqual(rows);

    const bySize = chunkRowsBySize(rows, 20_000, 1000);
    for (const part of bySize) {
      expect(new TextEncoder().encode(JSON.stringify(part)).length).toBeLessThanOrEqual(20_000);
    }
    expect(bySize.flat()).toEqual(rows);
  });

  it("한글 긴 문구(최대 크기 행)도 기본 제한(600KB) 안으로 나뉜다", () => {
    const big = Array.from({ length: 300 }, (_, i) =>
      ({ rowNumber: i + 2, values: values(i, { description: "가".repeat(2000), faqAnswer1: "나".repeat(2000), faqAnswer2: "다".repeat(2000), faqAnswer3: "라".repeat(2000) }) })
    );
    const chunks = chunkRowsBySize(big);
    expect(chunks.length).toBeGreaterThan(1);
    for (const part of chunks) {
      expect(new TextEncoder().encode(JSON.stringify(part)).length).toBeLessThanOrEqual(600 * 1024);
    }
  });

  it("toPayload는 파싱 경고를 빼고 보낸다", () => {
    expect(toPayload([{ rowNumber: 2, values: { region: "a" }, warnings: [{ code: "x" as never, fields: [], message: "" }] }])).toEqual([
      { rowNumber: 2, values: { region: "a" } },
    ]);
  });

  it("서버는 형식이 틀린 입력을 거부하고, 모르는 칸은 버린다", () => {
    expect(sanitizeUploadPayload([{ rowNumber: 2, values: { region: "a", __proto__x: "b", memo: "c" } }])).toEqual([
      { rowNumber: 2, values: { region: "a" }, warnings: [] },
    ]);
    expect(sanitizeUploadPayload([])).toBeNull();
    expect(sanitizeUploadPayload("x")).toBeNull();
    expect(sanitizeUploadPayload([{ rowNumber: 1, values: {} }])).toBeNull(); // 머리글 줄 번호
    expect(sanitizeUploadPayload([{ rowNumber: 2, values: { region: 1 } }])).toBeNull();
    expect(sanitizeUploadPayload([{ rowNumber: 2, values: { region: "a".repeat(5001) } }])).toBeNull();
    expect(sanitizeUploadPayload([{ rowNumber: 2, values: {} }, { rowNumber: 2, values: {} }])).toBeNull();
    expect(sanitizeUploadPayload(Array.from({ length: 201 }, (_, i) => ({ rowNumber: i + 2, values: {} })))).toBeNull();
    expect(sanitizeStringList(["a", "b"], 2)).toEqual(["a", "b"]);
    expect(sanitizeStringList(["a", "b", "c"], 2)).toBeNull();
    expect(sanitizeStringList(["a", 1], 5)).toBeNull();
  });
});
