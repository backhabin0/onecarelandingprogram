/**
 * 7단계: 양식 새 칸(시/군·city_slug·대표 사진·사진 설명·현장 사례) 파싱과 구 양식 호환,
 * 업로드 검사(키워드 과다 반복·얇은 페이지·시/군 짝·사진 URL), 프롬프트의 빈칸 안내,
 * migration 016(공개 함수가 새 칸 복사, 얇은 페이지 noindex 옵션), 날짜별 공개 주소(KST 경계), sitemap 지역 모음.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import sitemap from "@/app/sitemap";
import { BULK_UPLOAD_COLUMNS } from "@/lib/bulk-upload/columns";
import { checkBulkUploadRows, collectSeoQualityWarnings, countKeyword } from "@/lib/bulk-upload/check";
import { parsePastedUpload, sheetToUploadRows, type UploadValues } from "@/lib/bulk-upload/parse";
import { buildBulkPrompts } from "@/lib/bulk-upload/prompt";
import { DEFAULT_SIMILARITY_THRESHOLDS } from "@/lib/bulk-upload/similarity";
import { getPublishedUrlsForDate } from "@/lib/local-pages";
import { createMigratedDb } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { FakeSupabase } from "./helpers/fake-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";

const HEADERS = BULK_UPLOAD_COLUMNS.map((c) => c.header);
const OLD_HEADERS = HEADERS.slice(0, 20); // 7단계 전 양식(20칸)
const ctx = { existingSlugs: [], existingPairs: [], corpus: [], thresholds: DEFAULT_SIMILARITY_THRESHOLDS };
const LONG = "가".repeat(220);

const base = (patch: UploadValues = {}): UploadValues => ({
  region: "산본동",
  keyword: "헬스장",
  regionSlug: "sanbon",
  keywordSlug: "gym",
  businessName: "원케어",
  title: "산본동 헬스장 원케어",
  description: LONG,
  ...patch,
});
const check = (values: UploadValues) => checkBulkUploadRows([{ rowNumber: 2, values, warnings: [] }], ctx).rows[0];

describe("양식 새 칸 파싱과 구 양식 호환", () => {
  it("새 양식: 시/군·city_slug·대표 사진 URL·사진 설명(alt)·현장 사례를 읽는다(맨 뒤 5칸)", () => {
    // 7단계 5칸 뒤에 019 사진2·3 칸 4개가 더 붙는다(tests/photos.db.test.tsx)
    expect(HEADERS.slice(20, 25)).toEqual(["시/군", "city_slug", "대표 사진 URL", "사진 설명(alt)", "현장 사례"]);
    const row = ["산본동", "헬스장", "sanbon", "gym", "원케어", "제목", ...Array(14).fill(""), "군포시", "gunpo", "https://img.example/a.jpg", "내부 사진", "지난주 현장"];
    const parsed = sheetToUploadRows([HEADERS, row]);
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.ignoredHeaders).toEqual([]);
    expect(parsed.rows[0].values).toMatchObject({
      city: "군포시",
      citySlug: "gunpo",
      mainImageUrl: "https://img.example/a.jpg",
      mainImageAlt: "내부 사진",
      caseStudy: "지난주 현장",
    });
  });

  it("구 양식(20칸, 새 칸 없음) 파일·머리글 없는 붙여넣기도 그대로 읽히고 검사된다", () => {
    const row = ["산본동", "헬스장", "sanbon", "gym", "원케어", "산본동 헬스장 원케어", "", LONG];
    const fromFile = sheetToUploadRows([OLD_HEADERS, row]);
    expect(fromFile.fileErrors).toEqual([]);
    expect(fromFile.rows[0].values.city).toBeUndefined();

    const pasted = parsePastedUpload(row.join("\t"));
    expect(pasted.fileErrors).toEqual([]);
    expect(pasted.rows[0].values).toMatchObject({ region: "산본동", description: LONG });

    const checked = checkBulkUploadRows(fromFile.rows, ctx).rows[0];
    expect(checked.errors).toEqual([]);
    expect(checked.queueRow).toMatchObject({ city: null, city_slug: null, main_image_url: null, case_study: null });
  });

  it("머리글 이름은 공백·대소문자를 무시한다(예: '사진설명(ALT)')", () => {
    const parsed = sheetToUploadRows([[...OLD_HEADERS.slice(0, 6), "사진설명(ALT)", "City_Slug", "시/군"], ["산본동", "헬스장", "sanbon", "gym", "원케어", "제목", "alt", "gunpo", "군포시"]]);
    expect(parsed.rows[0].values).toMatchObject({ mainImageAlt: "alt", citySlug: "gunpo", city: "군포시" });
  });
});

describe("업로드 검사(7단계)", () => {
  it("시/군과 city_slug는 함께, city_slug 형식, 사진 URL은 http(s), 글자 수", () => {
    expect(check(base({ city: "군포시" })).errors.map((e) => e.message)).toContain("시/군과 city_slug는 함께 입력하거나 둘 다 비워 주세요.");
    expect(check(base({ city: "군포시", citySlug: "군포" })).errors.map((e) => e.code)).toContain("invalid_slug");
    expect(check(base({ mainImageUrl: "img.example/a.jpg" })).errors.map((e) => e.message)).toContain(
      "대표 사진 URL은 http:// 또는 https://로 시작하는 주소만 입력할 수 있습니다."
    );
    expect(check(base({ caseStudy: "가".repeat(2001) })).errors.map((e) => e.message)).toContain("현장 사례는 2000자 이내로 입력해주세요.");
    expect(check(base({ region: "가".repeat(51) })).errors.map((e) => e.message)).toContain("지역은 50자 이내로 입력해주세요.");
    const ok = check(base({ city: "군포시", citySlug: "Gunpo", mainImageUrl: "https://img.example/a.jpg", mainImageAlt: "내부" }));
    expect(ok.errors).toEqual([]);
    expect(ok.queueRow).toMatchObject({ city: "군포시", city_slug: "gunpo", main_image_url: "https://img.example/a.jpg", main_image_alt: "내부" });
  });

  it("키워드 과다 반복: 대표+소개 문구에 같은 키워드가 5번 넘으면 경고(저장 가능)", () => {
    expect(countKeyword("헬스장 헬스장헬스장 HELLO hello", "hello")).toBe(2);
    expect(countKeyword("헬스장 헬스장헬스장", "헬스장")).toBe(3);
    const five = check(base({ heroText: "헬스장 헬스장", description: `${LONG} 헬스장 헬스장 헬스장` }));
    expect(five.warnings.map((w) => w.code)).not.toContain("keyword_overuse");
    const six = check(base({ heroText: "헬스장 헬스장 헬스장", description: `${LONG} 헬스장 헬스장 헬스장` }));
    expect(six.warnings.find((w) => w.code === "keyword_overuse")?.message).toMatch(/"헬스장"가 6번/);
    expect(six.errors).toEqual([]);
  });

  it("얇은 페이지: 소개 문구 200자 미만 + 사진·현장 사례 없음이면 경고만(저장 가능)", () => {
    const short = (patch: UploadValues = {}) => collectSeoQualityWarnings(base({ description: "짧은 소개", ...patch }));
    expect(short().map((w) => w.code)).toEqual(["thin_page"]);
    expect(short({ mainImageUrl: "https://img.example/a.jpg" })).toEqual([]);
    expect(short({ caseStudy: "현장 이야기" })).toEqual([]);
    expect(collectSeoQualityWarnings(base({ description: "가".repeat(200) }))).toEqual([]);
    const row = check(base({ description: "짧은 소개" }));
    expect(row.status).toBe("warning");
    expect(row.errors).toEqual([]);
  });

  it("프롬프트: 새 칸은 '비워 둘 칸'으로 안내하고 입력 표에서도 빈칸", () => {
    const { prompts } = buildBulkPrompts({
      regions: [{ name: "산본동", slug: "sanbon" }],
      keywords: [{ name: "헬스장", slug: "gym" }],
      business: { businessName: "원케어", phone: "", kakaoUrl: "", address: "", template: "template-a", industry: "" },
    });
    const text = prompts[0].text;
    expect(text).toContain("[비워 둘 칸 — 채우지 마세요]");
    expect(text).toContain("- 시/군, city_slug, 대표 사진 URL, 사진 설명(alt), 현장 사례");
    const lines = text.split("\n");
    const header = lines[lines.findIndex((l) => l.startsWith("[입력 표]")) + 1].split("\t");
    const row = lines[lines.findIndex((l) => l.startsWith("[입력 표]")) + 2].split("\t");
    expect(header).toEqual(HEADERS);
    expect(row.slice(20, 25)).toEqual(["", "", "", "", ""]);
  });
});

// ------------------------------------------------------------
// DB(PGlite)
// ------------------------------------------------------------

let base016: PGlite;
let db: PGliteInterface;

beforeAll(async () => {
  base016 = await createMigratedDb();
}, 60_000);
afterAll(async () => {
  await base016.close();
});
beforeEach(async () => {
  db = await base016.clone();
});

async function queue(slug: string, extra: Record<string, unknown>) {
  const cols = ["region", "keyword", "region_slug", "keyword_slug", "business_name", "title", "slug", "source", "state", ...Object.keys(extra)];
  const values = [`${slug}-r`, "헬스장", slug, "gym", "원케어", "제목", slug, "excel", "ready", ...Object.values(extra)];
  await db.query(
    `insert into public.landing_page_queue (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    values
  );
}

async function publish() {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    return (await tx.query<{ r: { published: number } }>("select public.publish_queued_landing_pages(50) r")).rows[0].r;
  });
}

describe("migration 016 공개 함수", () => {
  it("대기열의 지역·키워드·시/군·사진·사진 설명·현장 사례를 공개 페이지로 복사", async () => {
    await queue("full", {
      city: "군포시",
      city_slug: "gunpo",
      main_image_url: "https://img.example/a.jpg",
      main_image_alt: "내부 사진",
      case_study: "현장 이야기",
      description: "가".repeat(250),
    });
    expect((await publish()).published).toBe(1);
    const { rows } = await db.query(
      "select region, keyword, city, city_slug, main_image_url, main_image_alt, case_study from public.landing_pages where slug = 'full'"
    );
    expect(rows).toEqual([
      {
        region: "full-r",
        keyword: "헬스장",
        city: "군포시",
        city_slug: "gunpo",
        main_image_url: "https://img.example/a.jpg",
        main_image_alt: "내부 사진",
        case_study: "현장 이야기",
      },
    ]);
  });

  it("얇은 페이지 noindex: 기본 꺼짐이면 모두 색인, 켜면 얇은 페이지만 noindex", async () => {
    const seed = async () => {
      await queue("thin", { description: "짧음" });
      await queue("long", { description: "가".repeat(200) });
      await queue("photo", { description: "짧음", main_image_url: "https://img.example/p.jpg" });
      await queue("case", { description: "짧음", case_study: "사례" });
    };
    const noindexOf = async () =>
      (
        await db.query<{ slug: string; seo_noindex: boolean }>(
          `select lp.slug, s.seo_noindex from public.landing_pages lp
             join public.landing_page_seo_settings s on s.landing_page_id = lp.id order by lp.slug`
        )
      ).rows;

    await seed();
    await publish();
    expect((await noindexOf()).every((r) => r.seo_noindex === false)).toBe(true);

    const fresh = await base016.clone();
    db = fresh;
    await db.query("update public.auto_publish_settings set noindex_thin_pages = true");
    await seed();
    await publish();
    expect(await noindexOf()).toEqual([
      { slug: "case", seo_noindex: false },
      { slug: "long", seo_noindex: false },
      { slug: "photo", seo_noindex: false },
      { slug: "thin", seo_noindex: true },
    ]);
  });

  it("대기열 지역·키워드 50자 제한(새로 넣는 행부터)", async () => {
    await expect(
      db.query(
        `insert into public.landing_page_queue
           (region, keyword, region_slug, keyword_slug, business_name, title, slug, source)
         values ($1, '헬스장', 'r', 'gym', '원케어', '제목', 'too-long', 'excel')`,
        ["가".repeat(51)]
      )
    ).rejects.toThrow(/region_keyword_length_check/);
  });
});

describe("날짜별 공개 주소(한국 날짜 경계)", () => {
  it("한국 날짜 하루만, 공개 중인 것만, 공개 시각 순", async () => {
    const insert = (slug: string, publishedAt: string, status = "public") =>
      db.query(
        "insert into public.landing_pages (business_name, title, slug, status, published_at) values ('업체', '제목', $1, $2, $3)",
        [slug, status, publishedAt]
      );
    await insert("before", "2026-10-22T14:59:59.999Z"); // 한국 10-22 23:59
    await insert("first", "2026-10-22T15:00:00.000Z"); // 한국 10-23 00:00
    await insert("noon", "2026-10-23T03:00:00.000Z");
    await insert("private", "2026-10-23T04:00:00.000Z", "private");
    await insert("last", "2026-10-23T14:59:59.000Z"); // 한국 10-23 23:59
    await insert("after", "2026-10-23T15:00:00.000Z"); // 한국 10-24 00:00
    setFakeSupabase(new PgliteSupabase(db));

    const { data, error } = await getPublishedUrlsForDate("2026-10-23");
    expect(error).toBeNull();
    expect(data.map((d) => d.url)).toEqual([
      "https://example.test/first",
      "https://example.test/noon",
      "https://example.test/last",
    ]);
    expect((await getPublishedUrlsForDate("2026-10-22")).data.map((d) => d.slug)).toEqual(["before"]);
  });
});

describe("sitemap 지역 모음 페이지", () => {
  it("공개+noindex 아닌 페이지가 있는 시/군만 /area/{city_slug}로 들어가고 lastmod는 최신 페이지", async () => {
    const row = (id: string, city: string | null, citySlug: string | null, updated: string, status = "public") => ({
      id,
      slug: id,
      title: id,
      region: "동",
      keyword: "헬스장",
      city,
      city_slug: citySlug,
      status,
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: updated,
      published_at: null,
    });
    setFakeSupabase(
      new FakeSupabase({
        tables: {
          landing_pages: [
            row("g1", "군포시", "gunpo", "2026-10-20T00:00:00.000Z"),
            row("g2", "군포시", "gunpo", "2026-10-22T00:00:00.000Z"),
            row("a1", "안양시", "anyang", "2026-10-21T00:00:00.000Z"),
            row("s1", "수원시", "suwon", "2026-10-21T00:00:00.000Z", "private"),
            row("n1", null, null, "2026-10-21T00:00:00.000Z"),
          ],
          landing_page_seo_settings: [{ landing_page_id: "a1", seo_noindex: true }],
        },
        relations: {
          landing_pages: { landing_page_seo_settings: { kind: "one", localKey: "id", foreignKey: "landing_page_id" } },
        },
      })
    );
    const entries = await sitemap();
    const hubs = entries.filter((e) => e.url.includes("/area/"));
    expect(hubs.map((h) => [h.url, (h.lastModified as Date).toISOString()])).toEqual([
      ["https://example.test/area/gunpo", "2026-10-22T00:00:00.000Z"],
    ]);
    expect(entries.map((e) => e.url)).toEqual(
      expect.arrayContaining(["https://example.test/g1", "https://example.test/g2", "https://example.test/n1"])
    );
  });
});
