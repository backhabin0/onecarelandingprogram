/**
 * docs/samples/ 예시 파일 만들기: `npm run samples`
 * - onecare-bulk-upload-template.xlsx: 관리자 화면 "엑셀 양식 다운로드"와 같은 파일(머리글 + 예시 1행)
 * - prompt-3regions-x-2keywords.txt: "프롬프트 만들기" 탭에서 아래 예시 값으로 만든 프롬프트
 * - prompt-with-photos.txt: 같은 값 + 사진 보관함에 예시 사진 4장이 있을 때의 프롬프트
 * 화면과 같은 함수(lib/bulk-upload/template.ts, prompt.ts)를 쓰므로 실제 결과와 같다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { BULK_UPLOAD_TEMPLATE_FILENAME } from "@/lib/bulk-upload/columns";
import { buildBulkPrompts, parseSlugList } from "@/lib/bulk-upload/prompt";
import { TEMPLATE_COLUMN_WIDTHS, buildTemplateSheet } from "@/lib/bulk-upload/template";

const OUT_DIR = join(__dirname, "..", "docs", "samples");

/** 예시 입력(프롬프트 만들기 탭에 그대로 붙여넣을 수 있는 형식). 전화번호는 가짜 번호 */
export const SAMPLE_REGIONS = "산본동, sanbon\n금정동, geumjeong\n수리동, suri";
export const SAMPLE_KEYWORDS = "배관 수리, pipe-repair\n하수구 막힘, drain-unblocking";
export const SAMPLE_BUSINESS = {
  businessName: "원케어 설비(예시)",
  phone: "010-0000-0000",
  kakaoUrl: "",
  address: "",
  template: "template-a",
  industry: "배관 누수·하수구 막힘 출장 수리 서비스",
};
/** 예시 사진 보관함(이름·설명) */
export const SAMPLE_PHOTOS = [
  { name: "배관내시경.jpg", description: "배관 내시경으로 막힌 곳 확인" },
  { name: "하수구뚫음.jpg", description: "하수구 막힘 뚫는 작업 현장" },
  { name: "누수탐지.jpg", description: "벽 속 누수 위치 찾는 장비" },
  { name: "배관교체후.jpg", description: "" },
];

it("docs/samples 예시 파일 생성", async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  const xlsx = await writeXlsxFile(buildTemplateSheet(), {
    sheet: "대량등록",
    columns: TEMPLATE_COLUMN_WIDTHS,
    stickyRowsCount: 1,
  }).toBuffer();
  writeFileSync(join(OUT_DIR, BULK_UPLOAD_TEMPLATE_FILENAME), xlsx);

  const regions = parseSlugList(SAMPLE_REGIONS, { name: "지역", slug: "region_slug" });
  const keywords = parseSlugList(SAMPLE_KEYWORDS, { name: "키워드", slug: "keyword_slug" });
  expect(regions.errors).toEqual([]);
  expect(keywords.errors).toEqual([]);

  const result = buildBulkPrompts({ regions: regions.items, keywords: keywords.items, business: SAMPLE_BUSINESS });
  expect(result.errors).toEqual([]);
  expect(result.combinationCount).toBe(6);
  expect(result.prompts).toHaveLength(1);
  // 메모장에서도 한글이 깨지지 않게 UTF-8 BOM을 붙인다.
  writeFileSync(join(OUT_DIR, "prompt-3regions-x-2keywords.txt"), `﻿${result.prompts[0].text}\n`, "utf8");

  const withPhotos = buildBulkPrompts({
    regions: regions.items,
    keywords: keywords.items,
    business: SAMPLE_BUSINESS,
    photos: SAMPLE_PHOTOS,
  });
  expect(withPhotos.errors).toEqual([]);
  writeFileSync(join(OUT_DIR, "prompt-with-photos.txt"), `﻿${withPhotos.prompts[0].text}\n`, "utf8");
});
