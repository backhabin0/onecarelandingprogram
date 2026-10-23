import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/admin/consultations/export/route";
import { getConsultationRequestsForExport } from "@/lib/consultation-requests";
import { buildFixture, createFakeSupabase, SIZES } from "./helpers/fixtures";
import { setFakeSupabase } from "./helpers/current-supabase";

async function downloadCsv(query = "") {
  const response = await GET(
    new NextRequest(`https://example.test/admin/consultations/export${query}`)
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  // BOM 제거 후 CRLF로 줄 나눔. 문의내용에는 줄바꿈이 없으므로 줄 수 = 행 수 + 헤더 1
  return text.replace(/^﻿/, "").split("\r\n");
}

describe("상담 CSV 내보내기", () => {
  it.each(SIZES)("상담 %i건(+지난달 3건)을 전부 내보낸다", async (n) => {
    const fixture = buildFixture(n);
    setFakeSupabase(createFakeSupabase(fixture));

    const lines = await downloadCsv();
    expect(lines[0]).toBe("접수일,업체명,랜딩페이지 URL,이름,연락처,문의내용,상태");
    expect(lines).toHaveLength(fixture.consultations.length + 1);
  });

  it.each(SIZES)("상담 %i건: 중복·누락 없이, 최신순 + id 순서로 정렬된다", async (n) => {
    const fixture = buildFixture(n);
    setFakeSupabase(createFakeSupabase(fixture));

    const { data, error } = await getConsultationRequestsForExport({ sort: "newest" });
    expect(error).toBeNull();

    const ids = data.map((row) => row.id);
    expect(new Set(ids).size).toBe(fixture.consultations.length);

    const expected = fixture.consultations
      .slice()
      .sort((a, b) =>
        a.created_at === b.created_at
          ? String(b.id).localeCompare(String(a.id))
          : String(b.created_at).localeCompare(String(a.created_at))
      )
      .map((row) => row.id);
    expect(ids).toEqual(expected);
  });

  it("필터(상태=new)를 적용해도 1,000건을 넘으면 전부 내보낸다", async () => {
    const fixture = buildFixture(2500);
    setFakeSupabase(createFakeSupabase(fixture));

    const expectedNew = fixture.consultations.filter((c) => c.status === "new").length;
    expect(expectedNew).toBeGreaterThan(1000);

    const lines = await downloadCsv("?status=new&sort=oldest");
    expect(lines).toHaveLength(expectedNew + 1);
  });

  it("검색어(이름) 필터도 끝까지 읽는다", async () => {
    const fixture = buildFixture(2500);
    setFakeSupabase(createFakeSupabase(fixture));

    const expected = fixture.consultations.filter((c) =>
      String(c.name).includes("홍길동")
    ).length;
    expect(expected).toBeGreaterThan(1000);

    const lines = await downloadCsv(`?search=${encodeURIComponent("홍길동")}`);
    expect(lines).toHaveLength(expected + 1);
  });

  it("랜딩페이지 연결 정보와 삭제된 랜딩페이지 표시가 유지된다", async () => {
    setFakeSupabase(createFakeSupabase(buildFixture(1200)));
    const lines = await downloadCsv("?sort=oldest");
    expect(lines.some((line) => line.includes("삭제된 랜딩페이지"))).toBe(true);
    expect(lines.some((line) => /업체 \d+,\/shop-\d{5}/.test(line))).toBe(true);
    // 수식 주입 방지(기존 동작) 유지
    expect(lines.some((line) => line.includes("'=SUM(A1)"))).toBe(true);
  });
});
