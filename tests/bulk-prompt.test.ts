/**
 * 5단계: AI용 프롬프트 만들기(AI API 연결 없음), 붙여넣기 파싱, 사실 정보 경고.
 */
import { describe, expect, it } from "vitest";
import { BULK_UPLOAD_COLUMNS } from "@/lib/bulk-upload/columns";
import { checkBulkUploadRows, collectFactWarnings } from "@/lib/bulk-upload/check";
import { parsePastedTable, parsePastedUpload } from "@/lib/bulk-upload/parse";
import {
  AI_WRITTEN_FIELDS,
  PROMPT_CHUNK_SIZE,
  buildBulkPrompts,
  buildCombinations,
  parseSlugList,
  type PromptBusinessInfo,
  type SlugItem,
} from "@/lib/bulk-upload/prompt";
import { FAQ_MAX_LENGTH, LANDING_PAGE_MAX_LENGTH, SEO_MAX_LENGTH } from "@/lib/landing-page-validation";
import { DEFAULT_SIMILARITY_THRESHOLDS } from "@/lib/bulk-upload/similarity";

const REGION = { name: "지역", slug: "region_slug" };
const HEADERS = BULK_UPLOAD_COLUMNS.map((c) => c.header);
const col = (header: string) => HEADERS.indexOf(header);

const business: PromptBusinessInfo = {
  businessName: "원케어 헬스",
  phone: "010-1234-5678",
  kakaoUrl: "https://open.kakao.com/o/abc",
  address: "서울 강남구 테헤란로 1",
  template: "template-a",
  industry: "1:1 PT 중심의 소규모 헬스장",
};

const items = (prefix: string, n: number): SlugItem[] =>
  Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, slug: `${prefix === "지역" ? "r" : "k"}${i}` }));

/** 프롬프트의 [입력 표] 부분(머리글 + 행)을 칸 배열로 꺼낸다 */
function inputTable(prompt: string): string[][] {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l.startsWith("[입력 표]"));
  return lines.slice(start + 1).map((l) => l.split("\t"));
}

describe("지역·키워드 목록 읽기", () => {
  it("쉼표·탭·마지막 공백으로 구분, slug는 소문자로, 빈 줄은 건너뜀", () => {
    const parsed = parseSlugList("강남, Gangnam\n\n서초\tseocho\n서울 송파 songpa\n", REGION);
    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toEqual([
      { name: "강남", slug: "gangnam" },
      { name: "서초", slug: "seocho" },
      { name: "서울 송파", slug: "songpa" },
    ]);
  });

  it("잘못된 줄은 줄 번호와 함께 오류", () => {
    const parsed = parseSlugList("강남, gangnam\n서초\n송파, 송파\n강남, other\n마포, gangnam\na, b, c", REGION);
    expect(parsed.items).toEqual([{ name: "강남", slug: "gangnam" }]);
    expect(parsed.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(parsed.errors[1].message).toMatch(/영문 소문자, 숫자, 하이픈/);
    expect(parsed.errors[2].message).toMatch(/1번째 줄과 겹칩니다/);
  });
});

describe("프롬프트 만들기", () => {
  it("조합 수 = 지역 × 키워드(지역 순서 → 키워드 순서)", () => {
    const combos = buildCombinations(items("지역", 3), items("키워드", 4));
    expect(combos).toHaveLength(12);
    expect(combos.slice(0, 2).map((c) => `${c.region.name}/${c.keyword.name}`)).toEqual(["지역0/키워드0", "지역0/키워드1"]);
    const result = buildBulkPrompts({ regions: items("지역", 3), keywords: items("키워드", 4), business });
    expect(result.combinationCount).toBe(12);
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toMatchObject({ from: 1, to: 12, count: 12 });
    expect(result.prompts[0].text).not.toContain("전체 12행 중");
  });

  it(`${PROMPT_CHUNK_SIZE}개 넘으면 ${PROMPT_CHUNK_SIZE}개씩 나눈다(120개 → 50·50·20)`, () => {
    const result = buildBulkPrompts({ regions: items("지역", 12), keywords: items("키워드", 10), business });
    expect(result.prompts.map((p) => [p.from, p.to, p.count])).toEqual([
      [1, 50, 50],
      [51, 100, 50],
      [101, 120, 20],
    ]);
    expect(result.prompts[1].text).toContain("전체 120행 중 51~100행입니다(2/3)");
    const tables = result.prompts.map((p) => inputTable(p.text));
    expect(tables.map((t) => t.length - 1)).toEqual([50, 50, 20]);
    // 각 프롬프트에 머리글이 들어 있고, 나눈 행을 합치면 전체 조합과 같다
    for (const t of tables) expect(t[0]).toEqual(HEADERS);
    const allSlugs = tables.flatMap((t) => t.slice(1).map((r) => `${r[col("region_slug")]}-${r[col("keyword_slug")]}`));
    expect(new Set(allSlugs).size).toBe(120);
  });

  it("글자 수 제한은 공용 상수 값이 숫자로 들어간다", () => {
    const { prompts } = buildBulkPrompts({ regions: items("지역", 1), keywords: items("키워드", 1), business });
    const text = prompts[0].text;
    expect(text).toContain(`- 페이지 제목: ${LANDING_PAGE_MAX_LENGTH.title}자 이내`);
    expect(text).toContain(`- 대표 문구: ${LANDING_PAGE_MAX_LENGTH.heroText}자 이내`);
    expect(text).toContain(`- 소개 문구: ${LANDING_PAGE_MAX_LENGTH.description}자 이내`);
    expect(text).toContain(`- SEO 제목: ${SEO_MAX_LENGTH.title}자 이내`);
    expect(text).toContain(`- SEO 설명: ${SEO_MAX_LENGTH.description}자 이내`);
    expect(text).toContain(`- FAQ 질문1: ${FAQ_MAX_LENGTH.question}자 이내`);
    expect(text).toContain(`- FAQ 답변3: ${FAQ_MAX_LENGTH.answer}자 이내`);
    expect(AI_WRITTEN_FIELDS).toHaveLength(11);
  });

  it("작성 규칙(형식·복사·다양성·반복 금지·사실 정보 금지)이 들어 있다", () => {
    const { prompts } = buildBulkPrompts({ regions: items("지역", 1), keywords: items("키워드", 1), business });
    const text = prompts[0].text;
    expect(text).toContain("탭으로 구분한 표 하나만 출력합니다");
    expect(text).toContain("설명·인사말을 쓰지 말고");
    expect(text).toContain("지역, 키워드, region_slug, keyword_slug, 업체명, 전화, 카카오 URL, 주소, 템플릿");
    expect(text).toContain("한 글자도 바꾸지 말고");
    expect(text).toMatch(/아파트 단지, 상가·오피스, 주택가, 음식점/);
    expect(text).toContain("같은 문장이나 같은 문장 구조를 여러 행에서 반복하지 마세요");
    expect(text).toContain("억지로 여러 번 넣지 마세요");
    expect(text).toMatch(/가격, 할인.*수상, 경력.*전화번호.*지어내지 마세요/);
    expect(text).toContain("- 업종 설명: 1:1 PT 중심의 소규모 헬스장");
  });

  it("입력 표: 고정 칸은 준 값 그대로, AI가 쓸 칸은 비워 둔다", () => {
    const { prompts } = buildBulkPrompts({
      regions: [{ name: "강남", slug: "gangnam" }],
      keywords: [{ name: "헬스장", slug: "gym" }],
      business: { ...business, address: "서울\t강남구\n테헤란로", industry: "" },
    });
    const [head, row] = inputTable(prompts[0].text);
    expect(head).toEqual(HEADERS);
    expect(row).toHaveLength(HEADERS.length);
    expect(row[col("지역")]).toBe("강남");
    expect(row[col("keyword_slug")]).toBe("gym");
    expect(row[col("업체명")]).toBe("원케어 헬스");
    expect(row[col("전화")]).toBe("010-1234-5678");
    expect(row[col("주소")]).toBe("서울 강남구 테헤란로"); // 탭·줄바꿈은 공백으로
    expect(row[col("템플릿")]).toBe("template-a");
    for (const header of ["페이지 제목", "대표 문구", "소개 문구", "SEO 제목", "SEO 설명", "FAQ 질문1", "FAQ 답변3"]) {
      expect(row[col(header)]).toBe("");
    }
    expect(prompts[0].text).not.toContain("업종 설명");
  });

  it("입력이 부족하거나 조합이 2,000개를 넘으면 오류", () => {
    expect(buildBulkPrompts({ regions: [], keywords: items("키워드", 1), business }).errors).toEqual([
      "지역을 한 개 이상 입력해주세요.",
    ]);
    expect(
      buildBulkPrompts({ regions: items("지역", 1), keywords: items("키워드", 1), business: { ...business, businessName: " " } }).errors
    ).toEqual(["업체명을 입력해주세요."]);
    const big = buildBulkPrompts({ regions: items("지역", 50), keywords: items("키워드", 41), business });
    expect(big.prompts).toEqual([]);
    expect(big.errors[0]).toMatch(/2,050개/);
  });

  it("AI가 빈 칸을 채워 돌려준 표를 붙여넣으면 그대로 검사를 통과한다", () => {
    const { prompts } = buildBulkPrompts({
      regions: [{ name: "강남", slug: "gangnam" }, { name: "서초", slug: "seocho" }],
      keywords: [{ name: "헬스장", slug: "gym" }],
      business,
    });
    const [head, ...rows] = inputTable(prompts[0].text);
    const filled = rows.map((row, i) => {
      const r = [...row];
      r[col("페이지 제목")] = `${row[0]} 헬스장 원케어`;
      r[col("대표 문구")] = i === 0 ? "퇴근길에 들르기 좋은 동네 운동 공간" : "아이 등원 뒤 오전 시간을 위한 운동";
      r[col("소개 문구")] = i === 0 ? "아파트 단지 주민을 위한 개인 맞춤 운동 안내" : "주택가 이웃과 함께하는 소규모 수업 안내";
      r[col("FAQ 질문1")] = "처음인데 괜찮을까요?";
      r[col("FAQ 답변1")] = "상담 후 맞는 방법을 안내해 드립니다.";
      return r;
    });
    const pasted = [head, ...filled].map((r) => r.join("\t")).join("\n");
    const parsed = parsePastedUpload(pasted);
    expect(parsed.fileErrors).toEqual([]);
    const result = checkBulkUploadRows(parsed.rows, {
      existingSlugs: [],
      existingPairs: [],
      corpus: [],
      thresholds: DEFAULT_SIMILARITY_THRESHOLDS,
    });
    // 오류 없이 저장 가능. 소개 문구가 짧고 사진·사례가 없어 "얇은 페이지" 경고만 남는다(7단계).
    expect(result.rows.map((r) => [r.queueRow.slug, r.errors, r.warnings.map((w) => w.code)])).toEqual([
      ["gangnam-gym", [], ["thin_page"]],
      ["seocho-gym", [], ["thin_page"]],
    ]);
  });
});

describe("붙여넣기 파싱", () => {
  const dataRow = (region: string, slug: string) =>
    [region, "헬스장", slug, "gym", "원케어", `${region} 헬스장`].concat(Array(HEADERS.length - 6).fill(""));

  it("머리글 포함 탭 구분, 한글, 빈 줄(줄 번호 유지), CRLF", () => {
    const text = [HEADERS.join("\t"), dataRow("강남", "gangnam").join("\t"), "", "\t\t", dataRow("서초", "seocho").join("\t")].join("\r\n");
    const parsed = parsePastedUpload(text);
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.blankRowCount).toBe(2);
    expect(parsed.rows.map((r) => [r.rowNumber, r.values.region, r.values.title])).toEqual([
      [2, "강남", "강남 헬스장"],
      [5, "서초", "서초 헬스장"],
    ]);
  });

  it("머리글이 없으면 양식 열 순서로 읽고, 줄 번호는 붙여넣은 줄 기준", () => {
    const parsed = parsePastedUpload(["", dataRow("강남", "gangnam").join("\t"), dataRow("서초", "seocho").join("\t")].join("\n"));
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows.map((r) => [r.rowNumber, r.values.regionSlug])).toEqual([
      [1, "gangnam"],
      [2, "seocho"],
    ]);
  });

  it("머리글 없이 칸 수가 양식보다 많으면 거부", () => {
    const parsed = parsePastedUpload(Array(HEADERS.length + 1).fill("x").join("\t"));
    expect(parsed.fileErrors[0]).toMatch(/머리글을 포함해 붙여넣어/);
  });

  it("AI가 마크다운 표와 코드 블록으로 줘도 읽는다", () => {
    const md = [
      "```",
      `| ${HEADERS.slice(0, 6).join(" | ")} |`,
      `|${HEADERS.slice(0, 6).map(() => "---").join("|")}|`,
      "| 강남 | 헬스장 | gangnam | gym | 원케어 | 강남 헬스장 |",
      "```",
    ].join("\n");
    expect(parsePastedTable(md)).toEqual([HEADERS.slice(0, 6), ["강남", "헬스장", "gangnam", "gym", "원케어", "강남 헬스장"]]);
    const parsed = parsePastedUpload(md);
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows[0].values).toMatchObject({ region: "강남", title: "강남 헬스장" });
  });

  it("빈 붙여넣기는 오류", () => {
    expect(parsePastedUpload("  \n\n").fileErrors).toEqual(["붙여넣은 내용이 없습니다."]);
  });
});

describe("사실 정보 경고(전화번호·금액)", () => {
  it.each([
    "상담은 010-1234-5678로 연락주세요",
    "대표번호 02)123-4567",
    "02 123 4567 으로 문의",
    "01012345678",
    "고객센터 1588-1234",
    "+82 10-1234-5678",
  ])("전화번호: %s", (text) => {
    expect(collectFactWarnings({ description: text }).map((w) => w.code)).toEqual(["contains_phone"]);
  });

  it.each(["월 50,000원", "3만원부터", "5천 원 할인", "1억 매출", "₩10000", "지금 30% 할인", "12.5% off"])(
    "금액·할인: %s",
    (text) => {
      expect(collectFactWarnings({ faqAnswer2: text }).map((w) => w.code)).toEqual(["contains_price"]);
    }
  );

  it.each(["1:1 맞춤 PT", "주 3회 운동", "2024년 새 단장", "역에서 3분", "100% 예약제", "원하는 시간에"])(
    "경고하지 않음: %s",
    (text) => {
      expect(collectFactWarnings({ description: text, faqAnswer1: text })).toEqual([]);
    }
  );

  it("소개 문구·FAQ만 보고, 어느 칸인지 알려준다(대표 문구·전화 칸은 보지 않음)", () => {
    const warnings = collectFactWarnings({
      heroText: "010-1111-2222",
      phone: "010-1111-2222",
      description: "월 3만원",
      faqQuestion1: "010-9999-8888로 전화하면 되나요?",
      faqAnswer3: "02-123-4567",
    });
    expect(warnings).toEqual([
      {
        code: "contains_phone",
        fields: ["faqQuestion1", "faqAnswer3"],
        message: "FAQ 질문1, FAQ 답변3에 전화번호로 보이는 내용이 있습니다. AI가 지어낸 번호가 아닌지 확인해주세요.",
      },
      {
        code: "contains_price",
        fields: ["description"],
        message: "소개 문구에 가격·할인으로 보이는 내용이 있습니다. 실제 정보인지 확인해주세요.",
      },
    ]);
  });

  it("검사 결과에서는 경고(저장은 ready로 가능)", () => {
    const [row] = checkBulkUploadRows(
      [
        {
          rowNumber: 2,
          warnings: [],
          values: {
            region: "강남",
            keyword: "헬스장",
            regionSlug: "gangnam",
            keywordSlug: "gym",
            businessName: "원케어",
            title: "강남 헬스장",
            description: "첫 달 9,900원",
          },
        },
      ],
      { existingSlugs: [], existingPairs: [], corpus: [], thresholds: DEFAULT_SIMILARITY_THRESHOLDS }
    ).rows;
    expect(row.status).toBe("warning");
    expect(row.warnings.map((w) => w.code)).toEqual(["contains_price", "thin_page"]);
    expect(row.errors).toEqual([]);
  });
});
