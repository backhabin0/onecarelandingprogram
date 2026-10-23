/**
 * 대량 등록 파일 파싱: CSV(UTF-8/BOM/CP949, 따옴표, 줄바꿈), 엑셀(xlsx), 한글, 빈 줄, 머리글 검사.
 */
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import type { SheetData } from "write-excel-file/node";
import { BULK_UPLOAD_COLUMNS } from "@/lib/bulk-upload/columns";
import {
  MAX_UPLOAD_ROWS,
  decodeCsvBytes,
  parseCsvText,
  parseUploadFile,
  sheetToUploadRows,
} from "@/lib/bulk-upload/parse";
import { TEMPLATE_COLUMN_WIDTHS, buildTemplateSheet } from "@/lib/bulk-upload/template";
import { checkBulkUploadRows } from "@/lib/bulk-upload/check";
import { DEFAULT_SIMILARITY_THRESHOLDS } from "@/lib/bulk-upload/similarity";

const HEADERS = BULK_UPLOAD_COLUMNS.map((c) => c.header);

/** Node에는 EUC-KR 인코더가 없어서, 디코더로 2바이트 조합을 모두 풀어 역표를 만든다. */
function encodeEucKr(text: string): Uint8Array {
  const decoder = new TextDecoder("euc-kr");
  const table = new Map<string, number[]>();
  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x41; trail <= 0xfe; trail += 1) {
      const ch = decoder.decode(new Uint8Array([lead, trail]));
      if (ch.length === 1 && ch !== "�" && !table.has(ch)) table.set(ch, [lead, trail]);
    }
  }
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) bytes.push(code);
    else {
      const pair = table.get(ch);
      if (!pair) throw new Error(`EUC-KR로 바꿀 수 없는 글자: ${ch}`);
      bytes.push(...pair);
    }
  }
  return new Uint8Array(bytes);
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

async function xlsxBuffer(data: SheetData): Promise<ArrayBuffer> {
  const buffer = await writeXlsxFile(data).toBuffer();
  return toArrayBuffer(new Uint8Array(buffer));
}

describe("CSV 텍스트 파싱", () => {
  it("따옴표 안의 쉼표·따옴표·줄바꿈, CRLF, BOM, 마지막 줄바꿈 없음", () => {
    const text = '﻿지역,소개 문구\r\n강남,"좋은 곳, ""최고"" 헬스장"\r\n서초,"첫 줄\n둘째 줄"';
    expect(parseCsvText(text)).toEqual([
      ["지역", "소개 문구"],
      ["강남", '좋은 곳, "최고" 헬스장'],
      ["서초", "첫 줄\n둘째 줄"],
    ]);
  });

  it("끝에 줄바꿈이 있어도 빈 행을 더 만들지 않는다, 빈 칸은 빈 문자열", () => {
    expect(parseCsvText("a,b\n1,\n")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });
});

describe("CSV 인코딩", () => {
  it("UTF-8(BOM 있음/없음)", () => {
    const utf8 = new TextEncoder().encode("지역,키워드");
    expect(decodeCsvBytes(utf8)).toBe("지역,키워드");
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe("지역,키워드");
  });

  it("엑셀 기본 저장 형식(CP949/EUC-KR)도 한글이 깨지지 않는다", () => {
    const bytes = encodeEucKr("지역,키워드\n강남,헬스장");
    expect(decodeCsvBytes(bytes)).toBe("지역,키워드\n강남,헬스장");
  });

  it("CP949 CSV 파일 전체 파싱", async () => {
    const csv = `${HEADERS.join(",")}\n강남,헬스장,gangnam,gym,원케어,강남 헬스장`;
    const parsed = await parseUploadFile("업로드.csv", toArrayBuffer(encodeEucKr(csv)));
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows[0].values).toMatchObject({ region: "강남", keyword: "헬스장", businessName: "원케어" });
  });
});

describe("표 → 행", () => {
  it("머리글 이름으로 칸을 찾는다(순서·공백·대소문자 무관), 모르는 머리글은 무시", () => {
    const parsed = sheetToUploadRows([
      ["키워드", " 지역 ", "REGION_SLUG", "keyword_slug", "업체명", "페이지제목", "SEO제목", "메모"],
      ["헬스장", "강남", "gangnam", "gym", "원케어", "강남 헬스장", "SEO", "무시됨"],
    ]);
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.ignoredHeaders).toEqual(["메모"]);
    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        values: {
          keyword: "헬스장",
          region: "강남",
          regionSlug: "gangnam",
          keywordSlug: "gym",
          businessName: "원케어",
          title: "강남 헬스장",
          seoTitle: "SEO",
        },
        warnings: [],
      },
    ]);
  });

  it("빈 줄은 건너뛰고 줄 번호는 원래 파일 기준을 유지한다, 칸 앞뒤 공백 제거", () => {
    const parsed = sheetToUploadRows([
      HEADERS,
      ["강남", "헬스장", "gangnam", "gym", "  원케어  ", "제목"],
      [],
      ["", "  ", null],
      ["서초", "헬스장", "seocho", "gym", "원케어2", "제목2"],
    ]);
    expect(parsed.blankRowCount).toBe(2);
    expect(parsed.rows.map((r) => r.rowNumber)).toEqual([2, 5]);
    expect(parsed.rows[0].values.businessName).toBe("원케어");
  });

  it("숫자로 저장된 전화번호는 경고", () => {
    const parsed = sheetToUploadRows([
      ["지역", "키워드", "region_slug", "keyword_slug", "업체명", "페이지 제목", "전화"],
      ["강남", "헬스장", "gangnam", "gym", "원케어", "제목", 1012345678],
    ]);
    expect(parsed.rows[0].values.phone).toBe("1012345678");
    expect(parsed.rows[0].warnings.map((w) => w.code)).toEqual(["phone_number_cell"]);
  });

  it("필수 머리글이 없거나 중복이면 파일 전체 거부", () => {
    expect(sheetToUploadRows([["지역", "키워드"], ["강남", "헬스장"]]).fileErrors).toEqual([
      "필수 머리글이 없습니다: region_slug, keyword_slug, 업체명, 페이지 제목",
    ]);
    expect(sheetToUploadRows([[...HEADERS, "지역"], []]).fileErrors).toEqual([
      '머리글 "지역"이(가) 두 번 이상 있습니다.',
    ]);
  });

  it("머리글 없음 / 데이터 없음 / 행 수 초과", () => {
    expect(sheetToUploadRows([]).fileErrors[0]).toMatch(/머리글이 없습니다/);
    expect(sheetToUploadRows([[], HEADERS]).fileErrors[0]).toMatch(/머리글이 없습니다/);
    expect(sheetToUploadRows([HEADERS, []]).fileErrors).toEqual(["머리글 아래에 데이터가 없습니다."]);

    const many = Array.from({ length: MAX_UPLOAD_ROWS + 1 }, (_, i) => [`지역${i}`, "k", "r", "k", "b", "t"]);
    expect(sheetToUploadRows([HEADERS, ...many]).fileErrors[0]).toMatch(/최대 2,000행/);
  });
});

describe("엑셀(xlsx) 파일", () => {
  it("한글·빈 줄·숫자 칸을 읽는다", async () => {
    const data: SheetData = [
      HEADERS.map((h) => ({ value: h })),
      ["강남", "헬스장", "gangnam", "gym", "원케어 헬스", "강남 헬스장", "대표 문구 ✨", "소개"].map((value) => ({ value })),
      [],
      ["서초", "필라테스", "seocho", "pilates", "서초 필라테스", "서초 필라테스 센터"].map((value) => ({ value })),
    ];
    const parsed = await parseUploadFile("대량등록.xlsx", await xlsxBuffer(data));

    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(parsed.rows[0].values).toMatchObject({
      region: "강남",
      businessName: "원케어 헬스",
      heroText: "대표 문구 ✨",
    });
    expect(parsed.rows[1].values.keyword).toBe("필라테스");
  });

  it("다운로드 양식을 그대로 올리면 머리글이 모두 인식되고 예시 행이 검사를 통과한다", async () => {
    const buffer = await writeXlsxFile(buildTemplateSheet(), { columns: TEMPLATE_COLUMN_WIDTHS }).toBuffer();
    const parsed = await parseUploadFile("template.xlsx", toArrayBuffer(new Uint8Array(buffer)));

    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.ignoredHeaders).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].values.phone).toBe("010-1234-5678");

    const result = checkBulkUploadRows(parsed.rows, {
      existingSlugs: [],
      existingPairs: [],
      corpus: [],
      thresholds: DEFAULT_SIMILARITY_THRESHOLDS,
    });
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].queueRow.slug).toBe("gangnam-gym");
  });

  it("손상된 xlsx, 예전 xls, 다른 형식, 10MB 초과는 거부", async () => {
    expect((await parseUploadFile("a.xlsx", toArrayBuffer(new TextEncoder().encode("not zip")))).fileErrors[0]).toMatch(
      /엑셀 파일을 읽지 못했습니다/
    );
    expect((await parseUploadFile("a.xls", new ArrayBuffer(4))).fileErrors[0]).toMatch(/\.xlsx로 다시 저장/);
    expect((await parseUploadFile("a.txt", new ArrayBuffer(4))).fileErrors[0]).toMatch(/xlsx 또는 csv/);
    expect((await parseUploadFile("a.csv", new ArrayBuffer(10 * 1024 * 1024 + 1))).fileErrors[0]).toMatch(/10MB/);
  });
});
