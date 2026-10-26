/**
 * 관리자 화면 손질(feature/admin-tweaks)
 * 1) 오늘 공개된 주소 체크박스: migration 018(search_submission_checks)·권한, 체크 저장·해제, 화면에 DB 체크 상태 표시
 * 2) 업체명 일괄 변경: 랜딩페이지 목록·공개 대기열, 서버 재검사(필수·100자·100개), 검색, 홈 대표 업체 묶기 규칙 유지
 * 컴퓨터 안 Postgres(PGlite, migration 001~018)만 쓴다 — 운영 DB에는 연결하지 않는다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { asRole, createMigratedDb, readMigration, readRollback } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";
import type { LandingPage } from "@/types/landing-page";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { getCheckedLandingPageIds, setSearchSubmissionCheck } = await import("@/lib/search-submission-checks");
const { setSearchSubmissionCheckAction, renameQueueItemsAction, getQueueRenameTargetsAction } = await import(
  "@/app/admin/queue/actions"
);
const { renameLandingPagesAction, getLandingPageRenameTargetsAction } = await import("@/app/admin/pages/actions");
const { getLandingPagesPage } = await import("@/lib/landing-pages");
const { getPublishedUrlsForDate } = await import("@/lib/local-pages");
const { kstDateOf } = await import("@/lib/kst-date");
const { default: AdminQueuePage } = await import("@/app/admin/queue/page");
const { default: PageTable } = await import("@/components/admin/PageTable");
const { default: SelectAllResultsNotice } = await import("@/components/admin/SelectAllResultsNotice");
const { default: BusinessNameRenameBar } = await import("@/components/admin/BusinessNameRenameBar");
const { buildOrganizationJsonLd } = await import("@/lib/structured-data");
const { resolveLandingPageSeo } = await import("@/lib/seo-resolver");
const { withDirectionParticle } = await import("@/lib/business-info");
const { validateBusinessNameInput, BUSINESS_NAME_RENAME_CHUNK_SIZE } = await import("@/lib/landing-page-validation");
const { buildRenameConfirmMessage, chunkArray, describeCurrentNames, distinctBusinessNames } = await import(
  "@/lib/business-name-rename"
);

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const MISSING_ID = "99999999-9999-4999-8999-999999999999";

let base: PGlite;
let db: PGliteInterface;

beforeAll(async () => {
  base = await createMigratedDb();
}, 60_000);

afterAll(async () => {
  await base.close();
});

beforeEach(async () => {
  db = await base.clone();
  setFakeSupabase(new PgliteSupabase(db));
});

async function insertPage(slug: string, values: { businessName?: string; title?: string; publishedAt?: string } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.landing_pages (business_name, title, slug, status, published_at)
     values ($1, $2, $3, 'public', $4) returning id`,
    [values.businessName ?? "업체", values.title ?? "제목", slug, values.publishedAt ?? null]
  );
  return rows[0].id;
}

/** n개 페이지(created_at 1초 간격). id 목록을 목록 화면 순서(최신 먼저)로 돌려준다 */
async function insertPages(n: number, name = (i: number) => `업체 ${i}`) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.landing_pages (business_name, title, slug, status, created_at)
     select ($1::text[])[i + 1], '제목 ' || i, 'page-' || i, 'public', timestamptz '2026-10-01' + make_interval(secs => i)
       from generate_series(0, $2::int - 1) as i
     returning id`,
    [Array.from({ length: n }, (_, i) => name(i)), n]
  );
  return rows.map((r) => r.id).reverse();
}

async function namesOf(table: string) {
  const { rows } = await db.query<{ business_name: string }>(
    `select business_name from public.${table} order by business_name`
  );
  return rows.map((r) => r.business_name);
}

describe("migration 018 search_submission_checks", () => {
  it("로그인 사용자만 조회·추가·삭제, anon은 아무것도 못 한다", async () => {
    const id = await insertPage("a");
    await asRole(db, "authenticated", (tx) =>
      tx.query("insert into public.search_submission_checks (landing_page_id) values ($1)", [id])
    );
    const read = await asRole(db, "authenticated", (tx) =>
      tx.query("select landing_page_id from public.search_submission_checks")
    );
    expect(read.rows).toEqual([{ landing_page_id: id }]);

    const anonRead = await asRole(db, "anon", (tx) => tx.query("select * from public.search_submission_checks"));
    expect(anonRead.rows).toEqual([]);
    const other = await insertPage("b");
    await expect(
      asRole(db, "anon", (tx) =>
        tx.query("insert into public.search_submission_checks (landing_page_id) values ($1)", [other])
      )
    ).rejects.toThrow();
    await asRole(db, "anon", (tx) => tx.query("delete from public.search_submission_checks"));
    expect((await db.query("select count(*)::int as n from public.search_submission_checks")).rows).toEqual([{ n: 1 }]);

    await asRole(db, "authenticated", (tx) => tx.query("delete from public.search_submission_checks"));
    expect((await db.query("select count(*)::int as n from public.search_submission_checks")).rows).toEqual([{ n: 0 }]);
  });

  it("checked_at·checked_by 기본값, 페이지를 지우면 체크도 지워진다", async () => {
    const id = await insertPage("a");
    await db.query("set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111'");
    await db.query("insert into public.search_submission_checks (landing_page_id) values ($1)", [id]);
    const { rows } = await db.query<{ checked_by: string; recent: boolean }>(
      "select checked_by, checked_at > now() - interval '1 minute' as recent from public.search_submission_checks"
    );
    expect(rows).toEqual([{ checked_by: "11111111-1111-4111-8111-111111111111", recent: true }]);
    await db.query("reset request.jwt.claim.sub");

    await db.query("delete from public.landing_pages where id = $1", [id]);
    expect((await db.query("select count(*)::int as n from public.search_submission_checks")).rows).toEqual([{ n: 0 }]);
  });

  it("018을 두 번 적용해도 되고, 018_down 후 다시 적용할 수 있다(다른 테이블은 그대로)", async () => {
    await insertPage("a");
    await db.exec(readMigration("018_search_submission_checks.sql"));
    await db.exec(readRollback("018_down.sql"));
    expect((await db.query("select to_regclass('public.search_submission_checks') as t")).rows).toEqual([{ t: null }]);
    expect((await db.query("select count(*)::int as n from public.landing_pages")).rows).toEqual([{ n: 1 }]);
    await db.exec(readMigration("018_search_submission_checks.sql"));
    expect((await db.query("select to_regclass('public.search_submission_checks')::text as t")).rows).toEqual([
      { t: "search_submission_checks" },
    ]);
  });
});

describe("수집 요청 완료 체크 저장(lib + action)", () => {
  it("체크·다시 체크(이미 체크됨도 성공)·해제", async () => {
    const id = await insertPage("a");
    expect(await setSearchSubmissionCheckAction(id, true)).toEqual({ success: true });
    expect(await setSearchSubmissionCheckAction(id, true)).toEqual({ success: true });
    expect((await getCheckedLandingPageIds([id])).data).toEqual(new Set([id]));

    expect(await setSearchSubmissionCheckAction(id, false)).toEqual({ success: true });
    expect(await setSearchSubmissionCheckAction(id, false)).toEqual({ success: true });
    expect((await getCheckedLandingPageIds([id])).data).toEqual(new Set());
  });

  it("100개 넘는 페이지도 나눠서 전부 읽는다", async () => {
    const ids = await insertPages(250);
    const checkedIds = ids.filter((_, i) => i % 3 === 0);
    for (const id of checkedIds) await setSearchSubmissionCheck(id, true);
    const { data, error } = await getCheckedLandingPageIds(ids);
    expect(error).toBeNull();
    expect(data).toEqual(new Set(checkedIds));
  });

  it("잘못된 입력·없는 페이지는 저장하지 않고 안내한다", async () => {
    expect(await setSearchSubmissionCheckAction("not-uuid", true)).toEqual({ success: false, error: "잘못된 요청입니다." });
    const id = await insertPage("a");
    expect(await setSearchSubmissionCheckAction(id, "yes")).toEqual({ success: false, error: "잘못된 요청입니다." });
    const missing = await setSearchSubmissionCheckAction(MISSING_ID, true);
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/페이지를 찾을 수 없습니다/);
  });

  it("anon 세션으로는 저장되지 않는다(RLS) — 실패 문구를 돌려준다", async () => {
    const id = await insertPage("a");
    setFakeSupabase(new PgliteSupabase(db, "anon"));
    const result = await setSearchSubmissionCheck(id, true);
    expect(result.success).toBe(false);
    expect(result.error).toBe("수집 요청 완료 표시를 저장하지 못했습니다. 다시 시도해주세요.");
    expect((await db.query("select count(*)::int as n from public.search_submission_checks")).rows).toEqual([{ n: 0 }]);
  });

  it("018 적용 전(테이블 없음)이면 체크 없이 목록만, 오류 안내", async () => {
    const id = await insertPage("a");
    await db.exec(readRollback("018_down.sql"));
    const { data, error } = await getCheckedLandingPageIds([id]);
    expect(data).toEqual(new Set());
    expect(error).toBe("수집 요청 완료 표시를 불러오지 못했습니다.");
  });

  it("공개 대기열 화면: 오늘 공개된 주소에 DB 체크 상태와 완료 수가 보인다", async () => {
    const now = new Date().toISOString();
    const a = await insertPage("today-a", { publishedAt: now });
    await insertPage("today-b", { publishedAt: now });
    await setSearchSubmissionCheck(a, true);

    const published = await getPublishedUrlsForDate(kstDateOf(new Date()));
    expect(published.data.map((row) => row.id)).toContain(a);

    const html = renderToStaticMarkup(await AdminQueuePage({ searchParams: Promise.resolve({}) }));
    expect(text(html)).toContain("1 / 2 수집요청 완료");
    const rows = Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)).map((m) => m[1]);
    const rowA = rows.find((row) => row.includes("/today-a"));
    const rowB = rows.find((row) => row.includes("/today-b"));
    expect(rowA).toMatch(/checked=""/);
    expect(rowB).not.toMatch(/checked=""/);
  });
});

describe("업체명 일괄 변경 — 검사 규칙·문구(순수 함수)", () => {
  it("필수·앞뒤 공백 제거 후 100자(생성·수정과 같은 글자 수 문구)", () => {
    expect(validateBusinessNameInput("  원케어배관 ")).toEqual({ value: "원케어배관" });
    expect(validateBusinessNameInput("   ").error).toBe("업체명은 필수 입력값입니다.");
    expect(validateBusinessNameInput("가".repeat(100)).error).toBeUndefined();
    expect(validateBusinessNameInput("가".repeat(101)).error).toBe("업체명은 100자 이내로 입력해주세요.");
  });

  it("100개씩 나누기", () => {
    expect(BUSINESS_NAME_RENAME_CHUNK_SIZE).toBe(100);
    const chunks = chunkArray(Array.from({ length: 250 }, (_, i) => i), 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(Array.from({ length: 250 }, (_, i) => i));
    expect(chunkArray([], 100)).toEqual([]);
  });

  it("확인 문구: n개, 지금 이름(많은 순, 3개까지), 새 이름 + 로/으로", () => {
    const targets = [
      { id: "1", businessName: "하수구뚫음 전문" },
      { id: "2", businessName: " 원케어 " },
      { id: "3", businessName: "원케어" },
    ];
    expect(distinctBusinessNames(targets)).toEqual(["원케어", "하수구뚫음 전문"]);
    expect(buildRenameConfirmMessage(targets, " 원케어배관 ", "페이지를")).toBe(
      '3개 페이지를 "원케어", "하수구뚫음 전문" → "원케어배관"으로 바꿉니다.'
    );
    expect(buildRenameConfirmMessage(targets.slice(0, 1), "원케어", "대기열 항목을")).toBe(
      '1개 대기열 항목을 "하수구뚫음 전문" → "원케어"로 바꿉니다.'
    );
    expect(describeCurrentNames(["a", "b", "c", "d", "e"])).toBe('"a", "b", "c" 외 2개');
    expect(withDirectionParticle("서울")).toBe("서울로");
    expect(withDirectionParticle("배관")).toBe("배관으로");
    expect(withDirectionParticle("ABC")).toBe("ABC(으)로");
  });
});

describe("업체명 일괄 변경 — 랜딩페이지", () => {
  it("선택한 페이지만, 이미 같은 이름은 건드리지 않음(updated_at 그대로)", async () => {
    const [a, b, c] = await Promise.all([
      insertPage("a", { businessName: "옛이름" }),
      insertPage("b", { businessName: "원케어배관" }),
      insertPage("c", { businessName: "다른업체" }),
    ]);
    await db.exec(`
      alter table public.landing_pages disable trigger landing_pages_set_updated_at;
      update public.landing_pages set updated_at = '2026-01-01T00:00:00Z';
      alter table public.landing_pages enable trigger landing_pages_set_updated_at;
    `);

    const result = await renameLandingPagesAction([a, b], "  원케어배관 ");
    expect(result).toEqual({ success: true, changed: 1 });

    const { rows } = await db.query<{ id: string; business_name: string; old: boolean }>(
      "select id, business_name, updated_at = '2026-01-01T00:00:00Z' as old from public.landing_pages"
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)).toMatchObject({ business_name: "원케어배관", old: false });
    expect(byId.get(b)).toMatchObject({ business_name: "원케어배관", old: true });
    expect(byId.get(c)).toMatchObject({ business_name: "다른업체", old: true });
  });

  it("서버에서 다시 검사: 빈 이름·101자·id 0개/101개·uuid 아님은 저장하지 않는다", async () => {
    const [a] = await insertPages(101);
    const ids = (await db.query<{ id: string }>("select id from public.landing_pages")).rows.map((r) => r.id);
    expect(await renameLandingPagesAction([a], " ")).toEqual({
      success: false,
      changed: 0,
      error: "업체명은 필수 입력값입니다.",
    });
    expect((await renameLandingPagesAction([a], "가".repeat(101))).error).toBe("업체명은 100자 이내로 입력해주세요.");
    for (const bad of [[], ids, ["not-uuid"], "x", null]) {
      expect(await renameLandingPagesAction(bad, "새이름")).toEqual({ success: false, changed: 0, error: "잘못된 요청입니다." });
    }
    expect(await renameLandingPagesAction([a], 123)).toMatchObject({ success: false });
    expect((await db.query("select count(*)::int as n from public.landing_pages where business_name = '새이름'")).rows).toEqual([
      { n: 0 },
    ]);
    expect((await renameLandingPagesAction(ids.slice(0, 100), "새이름")).changed).toBe(100);
  });

  it("검색(업체명·제목·URL)과 검색 결과 전체 선택(1,000개 넘어도 전부)", async () => {
    await insertPages(1200, (i) => (i % 2 === 0 ? "원케어배관" : "다른업체"));
    await insertPage("special-slug", { businessName: "업체X", title: "누수탐지 안내" });

    expect((await getLandingPagesPage(1, "원케어")).count).toBe(600);
    expect((await getLandingPagesPage(1, "누수탐지")).data.map((p) => p.slug)).toEqual(["special-slug"]);
    expect((await getLandingPagesPage(1, "special")).count).toBe(1);
    expect((await getLandingPagesPage(1)).count).toBe(1201);

    const all = await getLandingPageRenameTargetsAction("");
    expect(all.error).toBeNull();
    expect(all.data).toHaveLength(1201);
    expect(new Set(all.data.map((t) => t.id)).size).toBe(1201);
    const filtered = await getLandingPageRenameTargetsAction("다른");
    expect(filtered.data).toHaveLength(600);
    expect(filtered.data.every((t) => t.businessName === "다른업체")).toBe(true);
    expect((await getLandingPageRenameTargetsAction(1)).error).toBe("잘못된 요청입니다.");
  });

  it("검색 결과 전체를 100개씩 나눠 바꾸면 전부 바뀐다(1,200개)", async () => {
    await insertPages(1200, (i) => (i % 2 === 0 ? "옛이름" : "그대로"));
    const { data } = await getLandingPageRenameTargetsAction("옛이름");
    let changed = 0;
    for (const chunk of chunkArray(data.map((t) => t.id), BUSINESS_NAME_RENAME_CHUNK_SIZE)) {
      const result = await renameLandingPagesAction(chunk, "원케어배관");
      expect(result.success).toBe(true);
      changed += result.changed;
    }
    expect(changed).toBe(600);
    const names = await namesOf("landing_pages");
    expect(names.filter((n) => n === "원케어배관")).toHaveLength(600);
    expect(names.filter((n) => n === "그대로")).toHaveLength(600);
  });

  it("홈 대표 업체와 묶이는 규칙은 그대로: 이름이 똑같을 때만", async () => {
    const id = await insertPage("a", { businessName: "옛이름" });
    const site = { businessName: "원케어배관", description: "소개", phone: "010-0000-0000", kakaoUrl: null };
    const load = async () =>
      (await db.query<LandingPage>("select * from public.landing_pages where id = $1", [id])).rows[0];

    await renameLandingPagesAction([id], "원케어배관 산본점");
    const branch = await load();
    expect(buildOrganizationJsonLd(branch, resolveLandingPageSeo(branch, null), site)).not.toHaveProperty("@id");

    await renameLandingPagesAction([id], "원케어배관");
    const same = await load();
    expect(buildOrganizationJsonLd(same, resolveLandingPageSeo(same, null), site)).toMatchObject({
      "@id": "https://example.test/#business",
      name: "원케어배관",
    });
  });
});

describe("업체명 일괄 변경 — 공개 대기열", () => {
  async function insertQueue(n: number, published: (i: number) => boolean = () => false) {
    await db.query(
      `insert into public.landing_page_queue
         (region, keyword, region_slug, keyword_slug, business_name, title, slug, source, state, created_at)
       select '지역' || i, '헬스장', 'region-' || i, 'gym', '옛이름', '제목 ' || i, 'region-' || i || '-gym', 'excel',
              case when i = any($1::int[]) then 'published' when i % 10 = 0 then 'hold' else 'ready' end,
              timestamptz '2026-10-01' + make_interval(secs => i)
         from generate_series(0, $2::int - 1) as i`,
      [Array.from({ length: n }, (_, i) => i).filter(published), n]
    );
    return (
      await db.query<{ id: string; state: string }>(
        "select id, state from public.landing_page_queue order by created_at, id"
      )
    ).rows;
  }

  it("공개된 항목은 바꾸지 않고, 공개 전 항목만 바꾼다", async () => {
    const rows = await insertQueue(5, (i) => i === 1);
    const result = await renameQueueItemsAction(
      rows.map((r) => r.id),
      " 원케어배관 "
    );
    expect(result).toEqual({ success: true, changed: 4 });
    const { rows: after } = await db.query<{ state: string; business_name: string }>(
      "select state, business_name from public.landing_page_queue order by created_at"
    );
    expect(after.map((r) => r.business_name)).toEqual(["원케어배관", "옛이름", "원케어배관", "원케어배관", "원케어배관"]);
    expect(after[1].state).toBe("published");
  });

  it("서버 재검사: 빈 이름·101자·잘못된 id 목록", async () => {
    const rows = await insertQueue(2);
    const ids = rows.map((r) => r.id);
    expect((await renameQueueItemsAction(ids, "")).error).toBe("업체명은 필수 입력값입니다.");
    expect((await renameQueueItemsAction(ids, "가".repeat(101))).error).toBe("업체명은 100자 이내로 입력해주세요.");
    expect(await renameQueueItemsAction([], "새이름")).toEqual({ success: false, changed: 0, error: "잘못된 요청입니다." });
    expect(await renameQueueItemsAction(Array(101).fill(ids[0]), "새이름")).toMatchObject({ success: false });
    expect(await namesOf("landing_page_queue")).toEqual(["옛이름", "옛이름"]);
  });

  it("검색 결과 전체 선택: 공개된 항목 제외, 상태 탭·검색 조건 그대로(1,000개 넘어도 전부)", async () => {
    await insertQueue(1100, (i) => i % 4 === 1);
    const all = await getQueueRenameTargetsAction("all", "");
    expect(all.data).toHaveLength(1100 - 275);
    const hold = await getQueueRenameTargetsAction("hold", "");
    expect(hold.data).toHaveLength(110);
    const searched = await getQueueRenameTargetsAction("all", "지역10");
    // 지역10, 지역100~109, 지역1000~1099 중 공개(i % 4 === 1)가 아닌 것
    const expected = [10, ...Array.from({ length: 10 }, (_, i) => 100 + i), ...Array.from({ length: 100 }, (_, i) => 1000 + i)]
      .filter((i) => i % 4 !== 1).length;
    expect(searched.data).toHaveLength(expected);
    expect((await getQueueRenameTargetsAction("nope", "")).error).toBe("잘못된 요청입니다.");
  });
});

describe("화면(정적 렌더링)", () => {
  const pageRow = (id: string, name: string): LandingPage => ({
    id,
    business_name: name,
    title: "제목",
    slug: `slug-${id.slice(0, 4)}`,
    hero_text: null,
    description: null,
    phone: null,
    kakao_url: null,
    address: null,
    logo_url: null,
    main_image_url: null,
    template: "template-a",
    status: "public",
    published_at: null,
    region: null,
    keyword: null,
    city: null,
    city_slug: null,
    main_image_alt: null,
    case_study: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  });

  it("랜딩페이지 목록: 줄마다 체크박스 + 이 페이지 전체 선택, 기존 칸·버튼 그대로", () => {
    const html = renderToStaticMarkup(
      <PageTable pages={[pageRow("11111111-1111-4111-8111-111111111111", "원케어배관")]} totalCount={1} />
    );
    expect(html).toContain('aria-label="이 페이지 전체 선택"');
    expect(html).toContain('aria-label="원케어배관 선택"');
    for (const label of ["업체명", "URL", "템플릿", "상태", "작성일", "관리", "수정", "미리보기", "복제", "삭제", "URL 복사"]) {
      expect(text(html)).toContain(label);
    }
    // 아무것도 고르지 않았으면 업체명 바꾸기 막대는 없다
    expect(html).not.toContain("rename-business-name");
  });

  it("검색 결과가 없을 때와 페이지가 아예 없을 때 문구가 다르다", () => {
    expect(text(renderToStaticMarkup(<PageTable pages={[]} search="없는말" totalCount={0} />))).toContain("검색 결과가 없습니다.");
    expect(text(renderToStaticMarkup(<PageTable pages={[]} totalCount={0} />))).toContain("등록된 랜딩페이지가 없습니다.");
  });

  it("검색 결과 전체 선택 안내: 이 페이지를 다 고르고 결과가 더 있을 때만", () => {
    const props = {
      pageCount: 50,
      totalCount: 120,
      selectAllLabel: "검색 결과 120개 모두 선택",
      onSelectAll: async () => null,
      onClear: () => {},
    };
    expect(renderToStaticMarkup(<SelectAllResultsNotice {...props} selectedCount={50} allPageSelected={true} />)).toContain(
      "검색 결과 120개 모두 선택"
    );
    expect(renderToStaticMarkup(<SelectAllResultsNotice {...props} selectedCount={10} allPageSelected={false} />)).toBe("");
    expect(
      renderToStaticMarkup(<SelectAllResultsNotice {...props} totalCount={50} selectedCount={50} allPageSelected={true} />)
    ).toBe("");
    expect(text(renderToStaticMarkup(<SelectAllResultsNotice {...props} selectedCount={120} allPageSelected={true} />))).toContain(
      "검색 결과 120개를 모두 선택했습니다."
    );
  });

  it("업체명 바꾸기 막대: 선택 수, 100자 제한, 홈 대표 업체 안내", () => {
    const bar = (siteBusinessName: string | null) =>
      renderToStaticMarkup(
        <BusinessNameRenameBar
          selected={[{ id: "1", businessName: "a" }, { id: "2", businessName: "b" }]}
          objectLabel="페이지를"
          rename={async () => ({ success: true, changed: 0 })}
          onDone={() => {}}
          siteBusinessName={siteBusinessName}
        />
      );
    const html = bar("원케어배관");
    expect(text(html)).toContain("선택한 2개 업체명 바꾸기");
    expect(html).toMatch(/id="rename-business-name"[^>]*maxLength="100"/);
    expect(text(html)).toContain("홈 대표 업체명(&quot;원케어배관&quot;)과 똑같은 페이지만");
    expect(text(bar(null))).toContain("홈 대표 업체명이 비어 있어");
  });
});
