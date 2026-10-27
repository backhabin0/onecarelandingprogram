/**
 * 랜딩페이지 목록 URL 복사완료 체크(feature/list-copy-check)
 * - 체크는 search_submission_checks(018) 그대로 — 공개 대기열 '공개된 주소' 카드와 같은 상태
 * - 필터 전체/복사완료/안 한 것 + "n / 전체 복사완료", 페이지 나눔·검색과 함께, 비공개 페이지는 체크칸 없음
 * 컴퓨터 안 Postgres(PGlite, migration 001~)만 쓴다 — 운영 DB에는 연결하지 않는다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { createMigratedDb, readRollback } from "./helpers/pglite-db";
import { PgliteSupabase } from "./helpers/pglite-supabase";
import { setFakeSupabase } from "./helpers/current-supabase";
import type { LandingPage } from "@/types/landing-page";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { getLandingPagesPage, getLandingPageCopyCounts, isLandingPageCopyFilter, LANDING_PAGES_PAGE_SIZE } =
  await import("@/lib/landing-pages");
const { setSearchSubmissionCheckAction } = await import("@/app/admin/queue/actions");
const { default: AdminPagesPage } = await import("@/app/admin/pages/page");
const { default: AdminQueuePage } = await import("@/app/admin/queue/page");
const { default: PageTable } = await import("@/components/admin/PageTable");
const { default: PageCopyFilter } = await import("@/components/admin/PageCopyFilter");
const { checkedCountWithOverrides, copyThenCheck } = await import("@/lib/copy-check");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

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
  revalidatePath.mockClear();
});

/**
 * n개 페이지(created_at 1초 간격, slug page-i). i % 5 === 4는 비공개.
 * 목록 화면 순서(최신 먼저)로 { id, slug, status }를 돌려준다.
 */
async function insertPages(n: number, name = (i: number) => `업체 ${i}`) {
  const { rows } = await db.query<{ id: string; slug: string; status: string }>(
    `insert into public.landing_pages (business_name, title, slug, status, created_at)
     select ($1::text[])[i + 1], '제목 ' || i, 'page-' || i,
            case when i % 5 = 4 then 'private' else 'public' end,
            timestamptz '2026-10-01' + make_interval(secs => i)
       from generate_series(0, $2::int - 1) as i
     returning id, slug, status`,
    [Array.from({ length: n }, (_, i) => name(i)), n]
  );
  return rows.reverse();
}

/** 체크 행을 바로 넣는다(화면·조회 시험 준비용) */
async function check(ids: string[]) {
  await db.query(
    "insert into public.search_submission_checks (landing_page_id) select unnest($1::uuid[])",
    [ids]
  );
}

/** 모든 페이지를 차례로 읽어 slug 목록으로 */
async function allSlugs(search: string, filter: "all" | "done" | "todo") {
  const slugs: string[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await getLandingPagesPage(page, search, filter);
    expect(error).toBeNull();
    if (data.length === 0) break;
    slugs.push(...data.map((row) => row.slug));
  }
  return slugs;
}

describe("목록 조회 — 복사완료/안 한 것 필터(서버)", () => {
  it("필터 값 검사", () => {
    expect(["all", "done", "todo"].every(isLandingPageCopyFilter)).toBe(true);
    expect(["", "DONE", "checked", "x"].some(isLandingPageCopyFilter)).toBe(false);
  });

  it("복사완료 = 체크된 공개 페이지, 안 한 것 = 체크 안 된 공개 페이지(비공개는 둘 다 빠짐), 목록 순서 유지", async () => {
    const pages = await insertPages(30);
    const checkedPublic = pages.filter((p, i) => p.status === "public" && i % 3 === 0);
    const checkedPrivate = pages.filter((p) => p.status === "private").slice(0, 2);
    await check([...checkedPublic, ...checkedPrivate].map((p) => p.id));

    const done = await getLandingPagesPage(1, "", "done");
    expect(done.error).toBeNull();
    expect(done.data.map((p) => p.slug)).toEqual(checkedPublic.map((p) => p.slug));
    expect(done.count).toBe(checkedPublic.length);

    const todo = await getLandingPagesPage(1, "", "todo");
    const expectedTodo = pages.filter((p) => p.status === "public" && !checkedPublic.includes(p));
    expect(todo.data.map((p) => p.slug)).toEqual(expectedTodo.map((p) => p.slug));
    expect(todo.count).toBe(expectedTodo.length);

    // 화면에 넘기는 행에는 필터용 조인 칸이 없다(전체 목록과 같은 모양)
    expect(Object.keys(done.data[0]).sort()).toEqual(Object.keys((await getLandingPagesPage(1)).data[0]).sort());
    expect(done.data[0]).not.toHaveProperty("search_submission_checks");

    // 전체는 그대로(비공개 포함 30개)
    expect((await getLandingPagesPage(1, "", "all")).count).toBe(30);
    expect((await getLandingPagesPage(1)).count).toBe(30);
  });

  it("페이지 나눔: 필터 결과가 50개를 넘어도 빠짐·중복 없이 나뉜다(1,200개), 범위 밖 페이지는 빈 목록", async () => {
    const pages = await insertPages(1200);
    const publicPages = pages.filter((p) => p.status === "public"); // 960개
    const checked = publicPages.filter((_, i) => i % 4 !== 0); // 720개
    await check(checked.map((p) => p.id));

    const done = await allSlugs("", "done");
    expect(done).toEqual(checked.map((p) => p.slug));
    const todo = await allSlugs("", "todo");
    expect(todo).toEqual(publicPages.filter((_, i) => i % 4 === 0).map((p) => p.slug));

    const first = await getLandingPagesPage(1, "", "done");
    expect(first.data).toHaveLength(LANDING_PAGES_PAGE_SIZE);
    expect(first.count).toBe(720);
    const outOfRange = await getLandingPagesPage(99, "", "done");
    expect(outOfRange).toEqual({ data: [], count: 720, error: null });
  });

  it("검색과 함께: 검색 조건 + 필터 둘 다 맞는 페이지만", async () => {
    const pages = await insertPages(40, (i) => (i % 2 === 0 ? "원케어배관" : "다른업체"));
    const isWon = (p: { slug: string }) => Number(p.slug.slice("page-".length)) % 2 === 0;
    const wonPublic = pages.filter((p) => p.status === "public" && isWon(p));
    await check(wonPublic.slice(0, 3).map((p) => p.id));
    await check(pages.filter((p) => p.status === "public" && !isWon(p)).slice(0, 2).map((p) => p.id));

    const done = await getLandingPagesPage(1, "원케어", "done");
    expect(done.data.map((p) => p.slug)).toEqual(wonPublic.slice(0, 3).map((p) => p.slug));
    const todo = await getLandingPagesPage(1, "원케어", "todo");
    expect(todo.data.map((p) => p.slug)).toEqual(wonPublic.slice(3).map((p) => p.slug));
    // slug 검색도 같이
    expect((await getLandingPagesPage(1, "page-0", "done")).data.map((p) => p.slug)).toEqual(
      wonPublic.slice(0, 3).filter((p) => p.slug.startsWith("page-0")).map((p) => p.slug)
    );
  });

  it("n / 전체 숫자: 검색 조건에 맞는 공개 페이지 기준(비공개 체크는 세지 않음)", async () => {
    const pages = await insertPages(20, (i) => (i < 10 ? "가업체" : "나업체"));
    const publicIds = pages.filter((p) => p.status === "public").map((p) => p.id);
    await check([...publicIds.slice(0, 5), pages.find((p) => p.status === "private")!.id]);

    expect(await getLandingPageCopyCounts()).toEqual({ data: { checked: 5, total: 16 }, error: null });
    // 앞 5개(최신 = 나업체 쪽)만 체크됨
    expect(await getLandingPageCopyCounts("나업체")).toEqual({ data: { checked: 5, total: 8 }, error: null });
    expect(await getLandingPageCopyCounts("가업체")).toEqual({ data: { checked: 0, total: 8 }, error: null });
    expect(await getLandingPageCopyCounts("없는말")).toEqual({ data: { checked: 0, total: 0 }, error: null });
  });

  it("체크 테이블을 읽지 못하면(018 없음) 전체 목록은 그대로, 숫자만 오류 안내", async () => {
    await insertPages(5);
    await db.exec(readRollback("018_down.sql"));
    expect((await getLandingPagesPage(1)).count).toBe(5);
    expect(await getLandingPageCopyCounts()).toEqual({
      data: { checked: 0, total: 0 },
      error: "복사 완료 표시를 불러오지 못했습니다.",
    });
    expect((await getLandingPagesPage(1, "", "done")).error).toBe("랜딩페이지 목록을 불러오지 못했습니다.");
  });
});

describe("체크 저장 — 공개 대기열 '공개된 주소' 카드와 공유", () => {
  it("목록에서 체크하면 공개 대기열 카드에도 체크로 보이고, 두 화면 모두 갱신 요청", async () => {
    const now = new Date().toISOString();
    const { rows } = await db.query<{ id: string }>(
      `insert into public.landing_pages (business_name, title, slug, status, published_at)
       values ('가', '제목', 'today-a', 'public', $1), ('나', '제목', 'today-b', 'public', $1) returning id`,
      [now]
    );
    expect(await setSearchSubmissionCheckAction(rows[0].id, true)).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/queue");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/pages");

    const queueHtml = renderToStaticMarkup(await AdminQueuePage({ searchParams: Promise.resolve({}) }));
    expect(text(queueHtml)).toContain("1 / 2 수집요청 완료");

    // 반대로 공개 대기열에서 체크한 것(같은 action)이 목록에 보인다
    await setSearchSubmissionCheckAction(rows[1].id, true);
    const pagesHtml = renderToStaticMarkup(await AdminPagesPage({ searchParams: Promise.resolve({}) }));
    expect(text(pagesHtml)).toContain("2 / 2 복사완료");
    expect(pagesHtml).toMatch(/aria-label="가 복사완료" checked=""/);
    expect(pagesHtml).toMatch(/aria-label="나 복사완료" checked=""/);

    // 해제하면 둘 다에서 빠진다
    await setSearchSubmissionCheckAction(rows[0].id, false);
    expect(text(renderToStaticMarkup(await AdminQueuePage({ searchParams: Promise.resolve({}) })))).toContain(
      "1 / 2 수집요청 완료"
    );
    expect(text(renderToStaticMarkup(await AdminPagesPage({ searchParams: Promise.resolve({}) })))).toContain(
      "1 / 2 복사완료"
    );
  });
});

describe("목록 화면(/admin/pages)", () => {
  const render = async (params: Record<string, string>) =>
    renderToStaticMarkup(await AdminPagesPage({ searchParams: Promise.resolve(params) }));

  it("공개 페이지만 [URL 복사] 오른쪽에 복사완료 체크칸(업체명 선택 체크칸과 별개), 비공개는 숨김", async () => {
    const pages = await insertPages(5); // page-4만 비공개
    await check([pages.find((p) => p.slug === "page-3")!.id]);
    const html = await render({});

    const rows = Array.from(html.matchAll(/<tr class="border-b border-slate-100[^"]*">([\s\S]*?)<\/tr>/g)).map(
      (m) => m[1]
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      const name = row.match(/aria-label="(업체 \d) 선택"/)![1];
      if (name === "업체 4") {
        expect(row).not.toContain("복사완료");
        expect(row).not.toContain("URL 복사");
        continue;
      }
      // 업체명 선택 체크칸은 그대로 따로 있다
      expect(row).toContain(`aria-label="${name} 선택"`);
      // URL 복사 버튼 다음에 복사완료 체크칸
      expect(row.indexOf("URL 복사")).toBeLessThan(row.indexOf(`aria-label="${name} 복사완료"`));
      const box = row.match(new RegExp(`<input[^>]*aria-label="${name} 복사완료"[^>]*>`))![0];
      expect(box.includes('checked=""')).toBe(name === "업체 3");
    }
    expect(text(html)).toContain("1 / 4 복사완료");
  });

  it("필터 링크: 검색어 유지·1페이지부터, 지금 필터 표시, 페이지 나눔에 필터·검색 유지", async () => {
    const pages = await insertPages(150, (i) => (i % 2 === 0 ? "원케어" : "기타"));
    await check(pages.filter((p) => p.status === "public").map((p) => p.id).slice(0, 2));

    const html = await render({ search: "원케어", copy: "todo", page: "2" });
    expect(html).toContain('href="/admin/pages?search=%EC%9B%90%EC%BC%80%EC%96%B4"');
    expect(html).toContain('href="/admin/pages?search=%EC%9B%90%EC%BC%80%EC%96%B4&amp;copy=done"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/pages\?search=[^"]*copy=todo"|href="\/admin\/pages\?search=[^"]*copy=todo"[^>]*aria-current="page"/);
    // 원케어 75개 중 공개 60개, 체크된 2개 중 원케어인 것만 센다
    const wonChecked = pages
      .filter((p) => p.status === "public")
      .slice(0, 2)
      .filter((p) => Number(p.slug.slice(5)) % 2 === 0).length;
    expect(text(html)).toContain(`${wonChecked} / 60 복사완료`);
    // 안 한 것 = 60 - wonChecked개 → 2페이지
    expect(html).toContain('href="/admin/pages?search=%EC%9B%90%EC%BC%80%EC%96%B4&amp;copy=todo"'); // 이전(1페이지)
    expect(text(html)).toContain("2 / 2 페이지");
  });

  it("잘못된 copy 값은 전체로 본다", async () => {
    await insertPages(3);
    const html = await render({ copy: "zzz" });
    expect(text(html)).toContain("업체 0");
    expect(text(html)).toContain("0 / 3 복사완료");
  });

  it("필터 결과가 없으면 필터에 맞는 문구(새로 만들기 안내 아님)", () => {
    const copyCheck = (filter: "done" | "todo") => ({
      filter,
      checkedIds: [],
      checkedCount: 0,
      publicCount: 0,
      error: null,
    });
    const done = text(renderToStaticMarkup(<PageTable pages={[]} totalCount={0} copyCheck={copyCheck("done")} />));
    expect(done).toContain("복사완료한 페이지가 없습니다.");
    expect(done).not.toContain("등록된 랜딩페이지가 없습니다.");
    const todo = text(renderToStaticMarkup(<PageTable pages={[]} totalCount={0} copyCheck={copyCheck("todo")} />));
    expect(todo).toContain("복사 안 한 공개 페이지가 없습니다.");
  });

  it("체크를 불러오지 못하면 숫자 대신 안내, 목록·URL 복사는 그대로", async () => {
    await insertPages(3);
    await db.exec(readRollback("018_down.sql"));
    const html = await render({});
    expect(text(html)).toContain("복사 완료 표시를 불러오지 못했습니다.");
    expect(text(html)).not.toMatch(/\d+ \/ \d+ 복사완료/);
    // 틀린 체크를 보여주지 않도록 체크칸을 숨긴다
    expect(html).not.toContain('복사완료"');
    expect(text(html)).toContain("URL 복사");
    expect(text(html)).toContain("업체 2");
  });

  it("copyCheck 없이 쓰면 예전 모양 그대로(체크칸·필터 없음)", () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      business_name: "원케어배관",
      slug: "a",
      status: "public",
      template: "template-a",
      created_at: "2026-10-01T00:00:00Z",
    } as LandingPage;
    const html = renderToStaticMarkup(<PageTable pages={[row]} totalCount={1} />);
    expect(html).toContain("URL 복사");
    expect(html).not.toContain("복사완료");
    expect(html).not.toContain('aria-label="URL 복사"');
  });

  it("필터 컴포넌트 링크", () => {
    const html = renderToStaticMarkup(<PageCopyFilter current="all" search="" />);
    expect(html).toContain('href="/admin/pages"');
    expect(html).toContain('href="/admin/pages?copy=done"');
    expect(html).toContain('href="/admin/pages?copy=todo"');
    expect(text(html)).toContain("전체 복사완료 안 한 것");
  });
});

describe("복사 → 자동 체크, 숫자 계산(순수 함수)", () => {
  it("복사 성공 + 체크 전이면: 복사됨 표시 후 체크 저장", async () => {
    const calls: string[] = [];
    const ok = await copyThenCheck({
      copy: async () => void calls.push("copy"),
      onCopied: () => calls.push("copied"),
      needsCheck: true,
      check: async () => void calls.push("check"),
    });
    expect(ok).toBe(true);
    expect(calls).toEqual(["copy", "copied", "check"]);
  });

  it("이미 체크돼 있으면 다시 저장하지 않는다", async () => {
    const check = vi.fn(async () => {});
    expect(await copyThenCheck({ copy: async () => {}, onCopied: () => {}, needsCheck: false, check })).toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it("복사 실패면 체크하지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const check = vi.fn(async () => {});
    const onCopied = vi.fn();
    const ok = await copyThenCheck({
      copy: async () => {
        throw new Error("denied");
      },
      onCopied,
      needsCheck: true,
      check,
    });
    expect(ok).toBe(false);
    expect(onCopied).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("방금 바꾼 체크만큼 숫자를 더하고 뺀다(서버와 같은 값은 그대로)", () => {
    const server = new Set(["a", "b"]);
    expect(checkedCountWithOverrides(10, server, {})).toBe(10);
    expect(checkedCountWithOverrides(10, server, { c: true })).toBe(11);
    expect(checkedCountWithOverrides(10, server, { a: false })).toBe(9);
    expect(checkedCountWithOverrides(10, server, { a: true, c: false })).toBe(10);
    expect(checkedCountWithOverrides(10, server, { a: false, c: true, d: true })).toBe(11);
  });
});
